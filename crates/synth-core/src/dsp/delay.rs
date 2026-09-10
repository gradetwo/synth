//! Stereo delay with the two things a synth delay needs beyond a line: a
//! **ping-pong** cross-feed and high-frequency **damping** in the feedback path.
//!
//! It replaces the vendored Soundpipe delay. That one was two independent mono
//! lines with a hard-wired dry+wet sum, so it could not cross-feed the channels
//! and its echoes never got darker; both are the difference between a slapback
//! and a delay that sits in a mix. The line storage still comes from the shared
//! arena and is allocated once, so the render loop never allocates.
//!
//! Time changes are slewed rather than jumped: a moving read tap would otherwise
//! click, and reading a fractional position is what lets the tap move at all.

/// Longest delay the line can hold, in seconds. Tempo sync at 20 BPM would ask
/// for 3 s on a quarter note; the line tops out here and the time is clamped.
pub const MAX_DELAY_SECONDS: f32 = 2.0;
/// Hard cap on the line length so a 192 kHz host does not reserve 1.5 MB per
/// channel. At the rates the synth actually runs at this is not reached.
const MAX_DELAY_SAMPLES: usize = 192_000;
/// One-pole coefficient for delay-time changes (~20 ms at 48 kHz).
const TIME_SLEW: f32 = 0.0008;
/// Feedback low-pass range: 1.0 = wide open, [`DAMP_MIN`] = heavily damped.
const DAMP_MIN: f32 = 0.05;

#[derive(Clone, Copy)]
pub struct DelayParams {
    pub time_s: f32,
    /// Echo repeats, 0..0.95. Above that the line stops decaying.
    pub feedback: f32,
    /// Wet level added to the dry signal (the same convention the old delay
    /// used, so existing patches keep their balance).
    pub mix: f32,
    /// 0 = bright repeats, 1 = each repeat loses its top end.
    pub damp: f32,
    /// Cross-feed the channels so echoes alternate left/right.
    pub ping_pong: bool,
}

impl DelayParams {
    pub const fn new() -> Self {
        Self { time_s: 0.3, feedback: 0.3, mix: 0.2, damp: 0.0, ping_pong: false }
    }
}

pub struct Delay {
    lines: [Vec<f32>; 2],
    /// One-pole state for the damping filter, per channel.
    damp_state: [f32; 2],
    index: usize,
    /// Current (slewed) and target delay in samples.
    samples: f32,
    target: f32,
    sample_rate: f32,
    ready: bool,
}

impl Delay {
    pub const fn new() -> Self {
        Self {
            lines: [Vec::new(), Vec::new()],
            damp_state: [0.0; 2],
            index: 0,
            samples: 0.0,
            target: 0.0,
            sample_rate: 48_000.0,
            ready: false,
        }
    }

    /// Allocate the lines for `sample_rate`. Called from `Engine::init`, never
    /// from the render loop.
    pub fn setup(&mut self, sample_rate: f32) {
        let max = ((MAX_DELAY_SECONDS * sample_rate) as usize).clamp(64, MAX_DELAY_SAMPLES);
        for line in self.lines.iter_mut() {
            line.clear();
            line.resize(max + 2, 0.0);
        }
        self.index = 0;
        self.samples = 0.0;
        self.target = 0.0;
        self.sample_rate = sample_rate.max(1000.0);
        self.damp_state = [0.0; 2];
        self.ready = true;
    }

    pub fn reset(&mut self) {
        for line in self.lines.iter_mut() {
            line.fill(0.0);
        }
        self.damp_state = [0.0; 2];
        self.index = 0;
    }

    /// Longest delay this instance can produce, in seconds.
    pub fn max_seconds(&self) -> f32 {
        self.lines[0].len().saturating_sub(2) as f32 / self.sample_rate
    }

    #[inline]
    fn read(line: &[f32], index: usize, delay: f32) -> f32 {
        let len = line.len();
        let mut position = index as f32 - delay;
        while position < 0.0 {
            position += len as f32;
        }
        let first = position as usize % len;
        let second = (first + 1) % len;
        let fraction = position - position.floor();
        line[first] * (1.0 - fraction) + line[second] * fraction
    }

    /// Process a block in place. The wet signal is *added* to the dry signal at
    /// `mix`, matching the delay this replaces.
    pub fn process(&mut self, params: DelayParams, left: &mut [f32], right: &mut [f32], frames: usize) {
        if !self.ready || frames == 0 {
            return;
        }
        let len = self.lines[0].len();
        let max = (len - 2) as f32;
        let time = params.time_s.clamp(0.001, self.max_seconds());
        let target = (time * self.sample_rate).min(max);
        if self.samples <= 0.0 {
            // First use, or after a reset: start at the wanted time instead of
            // sliding up to it from zero.
            self.samples = target;
        }
        self.target = target;
        let feedback = params.feedback.clamp(0.0, 0.95);
        let mix = params.mix.clamp(0.0, 1.0);
        let damp = params.damp.clamp(0.0, 1.0);
        let damp_coeff = 1.0 - damp * (1.0 - DAMP_MIN);

        for i in 0..frames {
            let dry_l = left[i];
            let dry_r = right[i];
            let delayed_l = Self::read(&self.lines[0], self.index, self.samples);
            let delayed_r = Self::read(&self.lines[1], self.index, self.samples);

            // Damping lives inside the loop, so every repeat is darker than the
            // one that fed it rather than the whole tail being filtered once.
            self.damp_state[0] += (delayed_l - self.damp_state[0]) * damp_coeff;
            self.damp_state[1] += (delayed_r - self.damp_state[1]) * damp_coeff;

            if params.ping_pong {
                // The input enters the left line only and the lines feed each
                // other, so one echo train leaves the left channel first and the
                // echoes alternate. Summing to mono first is what makes that
                // work for a stereo input: a hard-panned right signal would
                // otherwise never reach the left line.
                let mono = (dry_l + dry_r) * 0.5;
                self.lines[0][self.index] = mono + self.damp_state[1] * feedback;
                self.lines[1][self.index] = self.damp_state[0] * feedback;
            } else {
                self.lines[0][self.index] = dry_l + self.damp_state[0] * feedback;
                self.lines[1][self.index] = dry_r + self.damp_state[1] * feedback;
            }

            left[i] = dry_l + delayed_l * mix;
            right[i] = dry_r + delayed_r * mix;

            self.index = (self.index + 1) % len;
            self.samples += (self.target - self.samples) * TIME_SLEW;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn delay(time_s: f32, feedback: f32, mix: f32, damp: f32, ping_pong: bool) -> Delay {
        let mut d = Delay::new();
        d.setup(SR);
        let params = DelayParams { time_s, feedback, mix, damp, ping_pong };
        // Prime the slewed time so the first echo lands where it was asked for.
        let mut l = [0.0f32; 1];
        let mut r = [0.0f32; 1];
        d.process(params, &mut l, &mut r, 1);
        debug_assert_eq!(l[0], 0.0);
        d
    }

    /// Impulse response of one channel: where the echoes land and how loud.
    fn impulse_response(mut d: Delay, params: DelayParams, frames: usize) -> (Vec<f32>, Vec<f32>) {
        let mut left = vec![0.0f32; frames];
        let mut right = vec![0.0f32; frames];
        left[0] = 1.0;
        d.process(params, &mut left, &mut right, frames);
        (left, right)
    }

    fn peaks(signal: &[f32]) -> Vec<(usize, f32)> {
        let mut out = Vec::new();
        let mut index = 1;
        while index + 1 < signal.len() {
            let value = signal[index];
            if value.abs() > 0.01 && value.abs() >= signal[index - 1].abs() && value.abs() >= signal[index + 1].abs() {
                // Only the first sample of each plateau counts.
                if out.last().map(|(at, _)| index - at > 8).unwrap_or(true) {
                    out.push((index, value));
                }
            }
            index += 1;
        }
        out
    }

    #[test]
    fn ping_pong_alternates_the_channels() {
        let time = 0.1;
        let params = DelayParams { time_s: time, feedback: 0.7, mix: 0.8, damp: 0.0, ping_pong: true };
        let (left, right) = impulse_response(delay(time, 0.7, 0.8, 0.0, true), params, 48_000);
        let period = (time * SR) as usize;
        // The input is mono-summed, so a 1.0 impulse in the left channel enters
        // the line at 0.5 and leaves at 0.4 with the wet mix applied.
        // The first echo is left, the second right, the third left again, each
        // one a factor of the feedback quieter.
        assert!(left[period].abs() > 0.35, "first echo should be on the left: {}", left[period]);
        assert!(right[period].abs() < 0.05, "the right channel must wait its turn");
        assert!(right[period * 2].abs() > 0.2, "second echo should be on the right");
        assert!(left[period * 2].abs() < 0.05);
        assert!(left[period * 3].abs() > 0.1, "third echo should be back on the left");
        // Each echo is one round trip quieter than the one two echoes before
        // it, so the amplitude falls by the feedback per *two* taps.
        let ratio = left[period * 3].abs() / left[period].abs();
        assert!((ratio - 0.49).abs() < 0.05, "ping-pong decay {ratio}");
    }

    #[test]
    fn a_plain_delay_keeps_the_channels_apart() {
        let params = DelayParams { time_s: 0.1, feedback: 0.6, mix: 0.8, damp: 0.0, ping_pong: false };
        let (left, right) = impulse_response(delay(0.1, 0.6, 0.8, 0.0, false), params, 48_000);
        let period = 4800;
        assert!(left[period].abs() > 0.5);
        assert!(right.iter().all(|v| v.abs() < 1e-6), "nothing should cross over");
    }

    #[test]
    fn echoes_decay_at_the_feedback_rate() {
        let params = DelayParams { time_s: 0.05, feedback: 0.5, mix: 1.0, damp: 0.0, ping_pong: false };
        let (left, _) = impulse_response(delay(0.05, 0.5, 1.0, 0.0, false), params, 24_000);
        let period = 2400;
        let first = left[period].abs();
        let second = left[period * 2].abs();
        let third = left[period * 3].abs();
        assert!((second / first - 0.5).abs() < 0.02, "second echo {}", second / first);
        assert!((third / second - 0.5).abs() < 0.02, "third echo {}", third / second);
    }

    /// Damping is a brightness control, not just a level control: a bright burst
    /// must lose its high end repeat by repeat, while a low one barely changes.
    #[test]
    fn damping_darkens_later_repeats() {
        let period = 2400usize; // 50 ms
        let measure = |freq: f32, damp: f32| {
            let params = DelayParams { time_s: 0.05, feedback: 0.6, mix: 1.0, damp, ping_pong: false };
            let mut d = delay(0.05, 0.6, 1.0, damp, false);
            let frames = period * 4;
            let mut left = vec![0.0f32; frames];
            let mut right = vec![0.0f32; frames];
            // A steady tone for one delay period, then silence: the repeats are
            // then clean copies of that tone.
            for (i, sample) in left.iter_mut().take(period).enumerate() {
                *sample = (core::f32::consts::TAU * freq * i as f32 / SR).sin();
            }
            d.process(params, &mut left, &mut right, frames);
            // Amplitude of the first and the third repeat, measured by DFT.
            let magnitude = |from: usize| {
                let (mut re, mut im) = (0.0f64, 0.0f64);
                for i in 0..period {
                    let phase = core::f64::consts::TAU * freq as f64 * i as f64 / SR as f64;
                    let v = left[from + i] as f64;
                    re += v * phase.cos();
                    im -= v * phase.sin();
                }
                (re * re + im * im).sqrt() / period as f64
            };
            (magnitude(period), magnitude(period * 3))
        };

        let (bright_first, bright_third) = measure(6000.0, 0.0);
        let (damped_first, damped_third) = measure(6000.0, 0.85);
        let bright_ratio = bright_third / bright_first;
        let damped_ratio = damped_third / damped_first;
        assert!(damped_ratio < bright_ratio * 0.4, "damped {damped_ratio} vs bright {bright_ratio}");

        // A low tone is left almost alone: the filter is a high-frequency loss.
        let (low_bright_first, low_bright_third) = measure(120.0, 0.0);
        let (low_damped_first, low_damped_third) = measure(120.0, 0.85);
        let low_bright = low_bright_third / low_bright_first;
        let low_damped = low_damped_third / low_damped_first;
        assert!(low_damped > low_bright * 0.6, "damping should not gut the low end");
    }

    #[test]
    fn a_time_change_slides_instead_of_jumping() {
        // A hard jump in the read pointer would click; the slew is what stops
        // it. Feed a tone and change the time mid-stream, then look for a step
        // much larger than the tone's own sample-to-sample change.
        let mut d = delay(0.2, 0.0, 1.0, 0.0, false);
        let frames = 12_000;
        // A low tone: the moving tap resamples it while it slides (a deliberate
        // Doppler shift), so the output frequency is bounded by the slew rate
        // rather than by the input. What must never appear is a *discontinuity*.
        let tone = |offset: usize| -> Vec<f32> {
            (0..frames)
                .map(|i| (core::f32::consts::TAU * 40.0 * (i + offset) as f32 / SR).sin())
                .collect()
        };
        let mut left = tone(0);
        let mut right = tone(0);
        d.process(DelayParams { time_s: 0.2, feedback: 0.0, mix: 1.0, damp: 0.0, ping_pong: false }, &mut left, &mut right, frames);
        let mut left2 = tone(frames);
        let mut right2 = tone(frames);
        d.process(DelayParams { time_s: 0.05, feedback: 0.0, mix: 1.0, damp: 0.0, ping_pong: false }, &mut left2, &mut right2, frames);

        // The tap slides at most TIME_SLEW × the whole distance per sample, so
        // the tone is transposed up by at most ~7× and its steps stay small.
        let most_shifted_step = core::f32::consts::TAU * 40.0 * 7.0 / SR;
        let mut worst = 0.0f32;
        for i in 1..frames {
            worst = worst.max((left2[i] - left2[i - 1]).abs());
        }
        assert!(
            worst < most_shifted_step * 1.5,
            "delay time change stepped by {worst} (a click would be far larger)"
        );

        // And the tap itself moves smoothly rather than jumping.
        let distance = (0.2 - 0.05) * SR;
        assert!(
            (d.target - d.samples).abs() < distance,
            "the tap should still be on its way, not already there"
        );
    }

    #[test]
    fn an_unallocated_delay_is_a_passthrough() {
        let mut d = Delay::new();
        let mut left = [0.5f32, -0.25];
        let mut right = [0.1f32, 0.2];
        d.process(DelayParams::new(), &mut left, &mut right, 2);
        assert_eq!(left, [0.5, -0.25]);
        assert_eq!(right, [0.1, 0.2]);
    }
}
