---
title: "Home assistant – Find who is home"
lead: "One cool feature of home assistant to detect who is home by detecting what devices are connected to the WIFI network. This feature can then be used in a wide variety of situation to such as, Detect an intruder if a sensor is activated when "
published: 2017-08-15
tags: [home-automation, home-lab]
authors:
    - name: "Kiran Joy"
---

One cool feature of home assistant to detect who is home by detecting what devices are connected to the WIFI network. This feature can then be used in a wide variety of situation to such as,

-   Detect an intruder if a sensor is activated when no one is home.
-   Turn off the lights\\electrical equipment’s when no one is home to save power etc.

Setting this is really simple,

1) Update the configuration.yaml with the following and then [restart home assistant](https://community.home-assistant.io/t/restart-stop-home-assistant-systemd/354/4). My home assistant is currently running on a Windows Server and the config file was found in this folder – C:\\Users\\USERNAME\\AppData\\Roaming.homeassistant (This folder structure is for a Windows 10 PC)

```yaml
device_tracker:
  - platform: ROUTER-PLATFORM
    host: ROUTER-IP
    username: YOURUSERNAME
    password: YOURPASSWORD
    interval_seconds: 10
    consider_home: 180
```

2) Set track to false for devices that you do not want to track in the newly created known\_devices.yaml (This file will be automatically created after step 1.In my case, I only wanted to track our mobile phones and not the laptops. Restart home assistant again.

```yaml
devicename:
  hide_if_away: false
  icon:Some icon
  mac: your mac
  name: friendly name
  picture:
  track: false
  vendor: ASUSTek COMPUTER INC.
```

3) Update the configuration.yaml to set “track_\_new \__devices” to false. This wasn’t initially added so that we could track all our devices to start with.Now that we have updated the config to track only the devices we want to track no new devices will show up in the dashboard.Without this, additional step all the devices that I set not to track keeps coming back every time Home Assistant was restarted

```YAML
device_tracker:
  - platform: netgear
    host: 192.168.0.1
    username: admin
    password: password
    interval_seconds: 10
    consider_home: 180
    track_new_devices: false
```

Below is a screeshot of Me and my wife being detected based on the fact that both our phones are home.

![Device discovery](media/home-assistant-find-who-is-home/device_discovery.png)

#### References

-   [Installing Home assistant](https://home-assistant.io/getting-started/)
-   [Configuring Device tracker](https://home-assistant.io/components/device_tracker/)
