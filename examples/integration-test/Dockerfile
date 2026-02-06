FROM alpine:latest

# Install basic tools
RUN apk add --no-cache ca-certificates

# Create app directory
WORKDIR /app

# Copy test file
COPY test.txt /app/

# Run a long-running process for testing
CMD ["sleep", "3600"]
