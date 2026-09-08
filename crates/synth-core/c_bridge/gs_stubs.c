/*
 * gs_stubs.c — inert stdio surface for the vendored Soundpipe base.c.
 *
 * Soundpipe references its offline file/console helpers from `base.c`. The GS-1
 * engine never calls them (we drive the DSP kernels block by block), but the
 * symbols must resolve for the freestanding wasm link. Defining them here keeps
 * the variadic declarations out of the Rust side.
 */
#include <stdarg.h>
#include <stddef.h>

typedef struct gs_shim_FILE FILE;

FILE *stdout = 0;
FILE *stderr = 0;

int sprintf(char *str, const char *format, ...)
{
    (void)format;
    if (str) str[0] = '\0';
    return 0;
}

int snprintf(char *str, size_t size, const char *format, ...)
{
    (void)format;
    if (str && size) str[0] = '\0';
    return 0;
}

int fprintf(FILE *stream, const char *format, ...)
{
    (void)stream;
    (void)format;
    return 0;
}

int printf(const char *format, ...)
{
    (void)format;
    return 0;
}

size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream)
{
    (void)ptr;
    (void)size;
    (void)stream;
    return nmemb;
}

/*
 * Minimal C++ runtime surface. Clang registers destructors of static objects
 * through __cxa_atexit; the synth's static voice pool lives for the lifetime of
 * the module, so destruction is intentionally a no-op.
 */
void *__dso_handle = 0;

int __cxa_atexit(void (*func)(void *), void *arg, void *dso)
{
    (void)func;
    (void)arg;
    (void)dso;
    return 0;
}

int atexit(void (*func)(void))
{
    (void)func;
    return 0;
}

void __cxa_pure_virtual(void)
{
    for (;;) {
    }
}

