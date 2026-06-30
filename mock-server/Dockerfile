FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    xrootd \
    && rm -rf /var/lib/apt/lists/*

# Create directories
RUN mkdir -p /data/test /var/spool/xrootd /run/xrootd /var/log/xrootd

# Create test file
RUN echo "Hello, XRootD!" > /data/test/testfile.txt && \
    echo "This is a test file for the mock server." >> /data/test/testfile.txt && \
    echo "Line 3: Testing basic file operations." >> /data/test/testfile.txt && \
    echo "Line 4: Reading offset and size should work." >> /data/test/testfile.txt && \
    echo "Line 5: End of test file." >> /data/test/testfile.txt

# Create xrootd user
RUN groupadd -r xrootd && useradd -r -g xrootd xrootd && \
    chown -R xrootd:xrootd /data /var/spool/xrootd /run/xrootd /var/log/xrootd

COPY xrootd-mock.cfg /etc/xrootd/xrootd.conf

EXPOSE 1094

CMD ["xrootd", "-c", "/etc/xrootd/xrootd.conf", "-n", "mock"]
