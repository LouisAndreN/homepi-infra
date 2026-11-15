# Runbook: power supply and hardware watchdog (v0.1.122)

## Requirement

A Pi 5 with an NVMe drive needs the official 27 W USB-C PD supply (5.1 V, 5 A) and a short cable
seated firmly in the connector. A 5 V / 3 A phone charger or a long thin cable holds at idle and
drops under load (Btrfs scrub, a GitOps apply building the dashboard, the NVMe at full speed).

## What is measured (role `power_metrics`)

`homepi-power-metrics.timer` (every minute) writes `homepi_power.prom` for node_exporter:

| Metric | Meaning |
|---|---|
| `homepi_power_throttled_bit{bit}` | `vcgencmd get_throttled`: 0 under-voltage now, 16 under-voltage since boot; 1/17 frequency capped; 2/18 throttled; 3/19 soft temperature limit |
| `homepi_power_ext5v_volts` | 5 V input measured by the PMIC (`vcgencmd pmic_read_adc EXT5V_V`); about 5.1 V on the official supply |
| `homepi_power_undervoltage_events{window="1h"}` | kernel `Undervoltage detected!` in the last hour, across a reboot |
| `homepi_power_undervoltage_events{window="boot"}` | the same since boot |

Alerts (`rules/power.yml`, tested by `prometheus/tests/power_test.yml`): `PiUndervoltage` (an event in
the last hour, warning), `PiUndervoltageRepeated` (more than 5, critical: stop deployments and
rollouts), `PiPowerMetricsStale` (the exporter stopped: the other two cannot fire).

## Hardware watchdog

`/etc/systemd/system.conf.d/50-homepi-watchdog.conf`: systemd feeds `/dev/watchdog0` (bcm2835-wdt,
`dtparam=watchdog=on`) with `RuntimeWatchdogSec=15s`, the limit of this watchdog; a hung system resets
after 15 s. Until v0.1.122 `RuntimeWatchdogUSec` was 0: a hung Pi stayed hung. The watchdog does
nothing for a power cut. Check: `systemctl show -p RuntimeWatchdogUSec` (15s) and
`cat /sys/class/watchdog/watchdog0/state` (active). Applied by `systemctl daemon-reexec`, no reboot.

## Incident 2026-11-15: reset when the supply cable was touched

The supply cable was touched at 15:15 JST and the Pi reset without a clean shutdown: no
`Stopping` line in the journal, no `terminating` line in mosquitto.log, mosquitto back with PID 1685.
It was seen only because the broker had logged connections (`log_type notice`) for an hour: the 7
devices reconnected once each, with no disconnection logged. Before the reset, the kernel had logged
`Undervoltage detected!` 7 times in 16 hours without anybody touching the cable (00:07, 00:47,
03:50 twice, 06:47 during the Btrfs scrub, 14:00, 15:15); after it, 9 times in 20 minutes.
`get_throttled` 0x50000 (under-voltage and throttling since boot), EXT5V 4.92 to 4.97 V at idle.

After the reset: no failed unit, `PRAGMA integrity_check` ok on the registry, InfluxDB and Loki
healthy, Btrfs error counters 0, `homepi-gitops-sync check` without drift. The interrupted GitOps run
was a check-mode pass (pki role, `stat` only).

## Procedure

1. `PiUndervoltage`: look at `homepi_power_ext5v_volts` and the hour of the events (load at that time).
2. Shut down cleanly before touching the supply: `sudo systemctl poweroff`, then replug.
3. Replace the supply or the cable; seat the cable and keep it from being moved.
4. Check after boot: `vcgencmd get_throttled` stays `0x0`, EXT5V about 5.1 V, no event for 24 h.
