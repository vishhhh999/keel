# GPU encoding (untested)

Set `KEEL_ENCODER=nvenc` to use the NVIDIA encoder. This path is written but has **not been run on a GPU**. Expect to debug it.

What is needed:

1. A host with an NVIDIA GPU and the proprietary driver.
2. The NVIDIA Container Toolkit installed, so Docker can pass the GPU through.
3. A GPU reservation on the `obs` service in `stack/docker-compose.yml`:

```yaml
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu, video]
```

4. The OBS image also needs NVIDIA's encode libraries visible in the container. The Ubuntu `obs-studio` package may need to be replaced with a build that includes NVENC support. Verify with the OBS log line that lists the available encoders.

When it works, CPU use should drop sharply and 1080p60 becomes comfortable. Report what you find so this page can be corrected.
