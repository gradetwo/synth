/* Minimal freestanding <stdlib.h> for the wasm32-unknown-unknown C/C++ bridge.
 * Allocation is served by the Rust-side bump allocator (see src/shim.rs). */
#ifndef GS_SHIM_STDLIB_H
#define GS_SHIM_STDLIB_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define RAND_MAX 2147483647
#define EXIT_SUCCESS 0
#define EXIT_FAILURE 1

void *malloc(size_t size);
void *calloc(size_t nmemb, size_t size);
void *realloc(void *ptr, size_t size);
void free(void *ptr);
void abort(void);
void exit(int status);

int rand(void);
void srand(unsigned int seed);

long strtol(const char *nptr, char **endptr, int base);

#ifdef __cplusplus
}
#endif

#endif
