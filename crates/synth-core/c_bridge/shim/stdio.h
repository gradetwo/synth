/* Minimal freestanding <stdio.h>. Soundpipe's base.c only needs these symbols to
 * link; the file/console helpers are never called by the synth engine. */
#ifndef GS_SHIM_STDIO_H
#define GS_SHIM_STDIO_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct gs_shim_FILE FILE;

extern FILE *stdout;
extern FILE *stderr;

int sprintf(char *str, const char *format, ...);
int snprintf(char *str, size_t size, const char *format, ...);
int fprintf(FILE *stream, const char *format, ...);
int printf(const char *format, ...);
size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream);

#ifdef __cplusplus
}
#endif

#endif
