export const XROOTD_HOST = process.env.XROOTD_HOST || "localhost";
export const XROOTD_PORT = parseInt(process.env.XROOTD_PORT || "1094", 10);
export const SERVER_URL = `root://${XROOTD_HOST}:${XROOTD_PORT}/`;

export const TEST_FILE_PATH = "/data/test/testfile.txt";
export const EXPECTED_FILE_CONTENTS = "Hello, XRootD!\n" +
  "This is a test file for the mock server.\n" +
  "Line 3: Testing basic file operations.\n" +
  "Line 4: Reading offset and size should work.\n" +
  "Line 5: End of test file.\n";

export const TEST_WRITE_DIR = "/data/test/integration";
