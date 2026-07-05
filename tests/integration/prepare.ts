import {rm, mkdir, writeFile} from "node:fs/promises";
import { EXPECTED_FILE_CONTENTS } from "./config.ts";

await rm("./mock-server/data/test", { recursive: true, force: true });
await mkdir("./mock-server/data/test");
await writeFile("./mock-server/data/test/testfile.txt", EXPECTED_FILE_CONTENTS);