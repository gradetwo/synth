/* Minimal freestanding <math.h>. Implementations live in Rust (src/shim.rs) so
 * that we never pull in a libc while keeping IEEE-accurate results. */
#ifndef GS_SHIM_MATH_H
#define GS_SHIM_MATH_H

#ifdef __cplusplus
extern "C" {
#endif

#define M_PI 3.14159265358979323846
#define M_E 2.71828182845904523536
#define HUGE_VALF (1.0f / 0.0f)
#define INFINITY (1.0f / 0.0f)
#define NAN (0.0f / 0.0f)

float sinf(float x);
float cosf(float x);
float tanf(float x);
float asinf(float x);
float acosf(float x);
float atanf(float x);
float atan2f(float y, float x);
float sqrtf(float x);
float fabsf(float x);
float expf(float x);
float logf(float x);
float log10f(float x);
float log2f(float x);
float powf(float x, float y);
float floorf(float x);
float ceilf(float x);
float roundf(float x);
float truncf(float x);
float fmodf(float x, float y);
float frexpf(float x, int *exp);
float ldexpf(float x, int exp);
float tanhf(float x);
float sinhf(float x);
float coshf(float x);
float fminf(float a, float b);
float fmaxf(float a, float b);

double sin(double x);
double cos(double x);
double tan(double x);
double sqrt(double x);
double fabs(double x);
double exp(double x);
double log(double x);
double log10(double x);
double pow(double x, double y);
double floor(double x);
double ceil(double x);
double round(double x);
double fmod(double x, double y);
double atan2(double y, double x);

#ifdef __cplusplus
}
#endif

#endif
