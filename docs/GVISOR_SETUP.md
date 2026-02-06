# gVisor Setup Guide

This guide explains how to install and configure gVisor (runsc) for Hersh.

## What is gVisor?

gVisor is an application kernel that provides an additional layer of isolation between running applications and the host operating system. It implements a substantial portion of the Linux system call interface in userspace, providing defense-in-depth for container workloads.

## Why gVisor for Hersh?

Hersh enforces gVisor by default for security reasons:
- **Kernel-level isolation**: Untrusted code cannot directly access host kernel
- **Attack surface reduction**: System calls are intercepted and validated
- **Resource isolation**: Better control over resource consumption
- **Compliance**: Meets security requirements for multi-tenant environments

## Installation

### Option 1: Using Install Script (Recommended)

```bash
# Run the installation script with sudo
sudo bash scripts/install-gvisor.sh
```

This script will:
1. Add gVisor GPG key and repository
2. Install runsc package
3. Configure Docker to use runsc runtime
4. Restart Docker daemon
5. Verify installation

### Option 2: Manual Installation

#### Step 1: Add gVisor Repository

```bash
# Add GPG key
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg

# Add repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list
```

#### Step 2: Install runsc

```bash
sudo apt-get update
sudo apt-get install -y runsc
```

#### Step 3: Configure Docker

Edit `/etc/docker/daemon.json`:

```json
{
  "runtimes": {
    "runsc": {
      "path": "/usr/bin/runsc"
    }
  }
}
```

#### Step 4: Restart Docker

```bash
sudo systemctl restart docker
```

## Verification

### Verify runsc Installation

```bash
# Check runsc version
runsc --version

# Expected output:
# runsc version release-20240304.0
# spec: 1.1.0
```

### Verify Docker Runtime

```bash
# List available runtimes
docker info | grep -A 10 "Runtimes:"

# Expected output should include:
# Runtimes: io.containerd.runc.v2 runc runsc
```

### Test gVisor Container

```bash
# Run a test container with gVisor
docker run --rm --runtime=runsc alpine echo "Hello from gVisor"

# If successful, you should see:
# Hello from gVisor
```

### Test with Hersh

```bash
# Run integration tests with gVisor
go test -tags=integration ./host -v

# The tests will use runsc runtime by default
```

## Troubleshooting

### Issue: `runsc not found`

**Solution**: Ensure runsc is installed and in PATH:
```bash
which runsc
# Should output: /usr/bin/runsc
```

### Issue: Docker doesn't recognize runsc runtime

**Solution**: Check Docker daemon configuration:
```bash
# View Docker config
cat /etc/docker/daemon.json

# Restart Docker
sudo systemctl restart docker
```

### Issue: Permission denied

**Solution**: Ensure Docker daemon has proper permissions:
```bash
sudo usermod -aG docker $USER
# Log out and log back in
```

### Issue: `unknown runtime specified runsc`

**Solution**: Verify runsc is in Docker's runtime list:
```bash
docker info | grep -i runtime

# If not listed, check daemon.json and restart Docker
```

## Testing Without gVisor

For development/testing without gVisor, you can use `runc`:

```go
// In test code
handler := host.NewRealEffectHandler(storage, compose, docker)
handler.SetDefaultRuntime("runc")  // Use runc instead of runsc
```

Or set runtime in ComposeBuilder:

```go
spec, _ := compose.GenerateSpec(compose.BuildOpts{
    ProgramID: id,
    ImageID:   imageID,
    StatePath: statePath,
    Runtime:   "runc",  // Override default runsc
})
```

## Production Recommendations

1. **Always use gVisor (runsc) in production**
2. **Monitor container performance**: gVisor has ~10-15% overhead
3. **Update regularly**: Keep gVisor updated for security patches
4. **Test workloads**: Verify your application works correctly with gVisor
5. **Fallback strategy**: Have a plan if gVisor is not available

## Performance Considerations

### gVisor vs runc Performance

| Metric | runc | runsc (gVisor) |
|--------|------|----------------|
| Syscall overhead | ~5-10 ns | ~100-200 ns |
| Memory overhead | Minimal | ~10-30 MB |
| I/O performance | Native | 80-90% native |
| Network performance | Native | 90-95% native |

### When to Use gVisor

✅ **Use gVisor (runsc) when:**
- Running untrusted code
- Multi-tenant environments
- Security is critical
- Compliance requirements

❌ **Consider runc when:**
- Maximum performance is required
- Trusted workloads only
- Development/testing environment
- Benchmarking native performance

## Additional Resources

- [gVisor Official Documentation](https://gvisor.dev/docs/)
- [gVisor GitHub Repository](https://github.com/google/gvisor)
- [Docker Runtime Documentation](https://docs.docker.com/engine/reference/commandline/dockerd/#daemon-configuration-file)

## Security Contracts Enforced by Hersh

Regardless of runtime (runsc or runc), Hersh enforces:

1. ✅ **Read-only root filesystem**
2. ✅ **Single RW volume** (`/state` only)
3. ✅ **No external port exposure** (`:8080` internal only)
4. ✅ **Security options** (`no-new-privileges:true`)
5. ✅ **Network isolation** (default: none)

gVisor adds an **additional layer** of kernel-level isolation on top of these contracts.
