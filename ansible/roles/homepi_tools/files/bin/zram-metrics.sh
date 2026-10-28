#!/bin/bash
# Generate metrics zram for node_exporter textfile collector

ZRAM_DEV="zram0"
MM_STAT=$(cat /sys/block/${ZRAM_DEV}/mm_stat)

# mm_stat fields:
# orig_data_size compr_data_size mem_used_total mem_limit mem_used_max same_pages pages_compacted huge_pages huge_pages_since
read orig_size compr_size mem_used mem_limit mem_used_max same_pages pages_compacted huge_pages huge_pages_since <<< "$MM_STAT"

OUTFILE="/var/lib/node_exporter/textfile_collector/zram.prom"

cat > "$OUTFILE" <<METRICS
# HELP zram_orig_data_size_bytes Uncompressed size of data stored in zram
# TYPE zram_orig_data_size_bytes gauge
zram_orig_data_size_bytes{device="${ZRAM_DEV}"} ${orig_size}

# HELP zram_compr_data_size_bytes Compressed size of data stored in zram
# TYPE zram_compr_data_size_bytes gauge
zram_compr_data_size_bytes{device="${ZRAM_DEV}"} ${compr_size}

# HELP zram_mem_used_bytes Memory used by zram
# TYPE zram_mem_used_bytes gauge
zram_mem_used_bytes{device="${ZRAM_DEV}"} ${mem_used}

# HELP zram_compression_ratio Compression ratio (orig/compr)
# TYPE zram_compression_ratio gauge
zram_compression_ratio{device="${ZRAM_DEV}"} $(awk "BEGIN {if (${compr_size} > 0) printf \"%.2f\", ${orig_size}/${compr_size}; else print 1}")
METRICS
