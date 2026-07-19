#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* The input buffer only needs to remain valid for the duration of fea_open(). */
int32_t fea_open(const uint8_t* data, uint32_t size);
void fea_close(void);
const char* fea_last_error(void);
uint32_t fea_array_count(void);
uint32_t fea_array_kind(uint32_t index);
uint32_t fea_array_type(uint32_t index);
uint32_t fea_array_association(uint32_t index);
uint32_t fea_array_components(uint32_t index);
uint32_t fea_array_value_count(uint32_t index);
const char* fea_array_name(uint32_t index);
const uint8_t* fea_array_data(uint32_t index);
uint32_t fea_array_byte_length(uint32_t index);

void fea_write_begin(void);
int32_t fea_write_add(const char* name, uint32_t kind, uint32_t type, uint32_t association,
                      uint32_t components, const uint8_t* data, uint32_t byte_length,
                      uint32_t value_count);
int32_t fea_write_finish(void);
const uint8_t* fea_write_data(void);
uint32_t fea_write_size(void);

#ifdef __cplusplus
}
#endif
