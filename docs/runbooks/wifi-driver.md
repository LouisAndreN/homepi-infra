# Runbook: IoT Wi-Fi driver and kernel updates

The IoT access point `wlx0013eff27090` (Realtek 0bda:b812) runs hostapd on the out-of-tree driver
`88x2bu`, built by DKMS from `/usr/src/rtl88x2bu-5.13.1`, upstream
https://github.com/morrownr/88x2bu-20210702 at `418d71cc00cd18b4a671f8c49ecce9b19cbfd3c9`
(2026-10-25; it detects backported cfg80211 changes from the kernel headers). The in-kernel
`rtw88_8822bu` is blacklisted (`/etc/modprobe.d/blacklist-rtw88.conf`): on 6.x kernels before 6.12
it is reported to lose AP mode after hours. Long-term fix: a MediaTek adapter (in-kernel mt76).

## Incident 2026-11-09..11

Ubuntu backported a cfg80211 API change (set_monitor_channel takes a net_device) into 6.8.0-1068.
The driver at fecac34 chose its signature from the kernel version and failed to build; the kernel
postinst failed, dpkg stayed half-configured and unattended upgrades failed every day (5 security
updates blocked). flash-kernel never copied 1068, so a reboot was still safe, by accident.
Fixed by moving the source to 418d71c, building for 1068, `dpkg --configure -a`, then a tryboot trial.

## Checks and alerts

`homepi-wifi-check` (every 15 min) and `boot_chain.yml`: WifiDriverMissingForNextBoot,
IotAccessPointDown, WifiDriverMissingForInstalledKernel, AptUpgradesFailing,
AptUpgradesNotRunning, WifiCheckStale.

## Trying a new kernel

    sudo homepi-kernel-trial stage 6.8.0-NNNN-raspi   # refuses a kernel without the 88x2bu module
    sudo homepi-kernel-trial reboot                   # waits for apt and dpkg, reboots once with tryboot
    sudo homepi-kernel-trial status

Pass (hostapd active, stations back within 10 minutes): the kernel becomes the default. Fail: plain
reboot into the previous kernel. No SSH after 15 minutes: power-cycle the Pi, the normal boot returns.

## Driver build fails for a new kernel

    sudo dkms status rtl88x2bu
    grep -E 'error:' /var/lib/dkms/rtl88x2bu/5.13.1/build/make.log
    # move the source to a newer upstream commit, then:
    sudo dkms build -m rtl88x2bu -v 5.13.1 -k <kernel> --force && sudo dkms install -m rtl88x2bu -v 5.13.1 -k <kernel> --force
    sudo dpkg --configure -a
