# Daily NILM energy (v1.4.0)

Measurement `nilm_daily` in `iot-archives`: one point per local day (Asia/Tokyo, timestamp = day
start), tag `leg` (`P_L1`, `P_L2`), fields `wh` (sum of the 5 min means x 5/60; a missing window counts
as zero, never interpolated) and `n5` (5 min windows with data; 288 = complete day).

- Written by the second part of `downsample_iot_hot_to_archives` every hour, for the day before
  yesterday, yesterday and today; each run overwrites the same points, so late data is counted.
- The value is the calibration live at the time: a later recalibration does not rewrite archived
  days. The dashboard still applies each leg's `since` (days before a leg was calibrated are not
  counted for that leg).
- Kept as long as `iot-archives` (8760 h): a year-on-year comparison needs a longer retention or a
  dedicated bucket (decision pending).
- Backups: the nightly line-protocol export covers it; the hourly delta does not (it exports
  `iot-archives` by timestamp over 2 h, and these points are dated at the day start).
- Backfill once after the upgrade: `docs/runbooks/influxdb-nilm-daily-backfill.flux` (dry run, then
  write), see the v1.4.0 release notes.
