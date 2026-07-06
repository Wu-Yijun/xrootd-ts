import { XRootDClient } from 'xrootd';
import { OpenFlags } from 'xrootd';

const client = new XRootDClient('root://localhost/');
await client.connect();


console.log(client.isConnected);
console.log(client.location);
console.log(await client.readdir('/data/test'))

// <-- throw errors below 
const file = await client.open('/data/test/testfile.txt', { flags: OpenFlags.Read });
const buf = await file.read(0, 400); // number instead of bigint
console.log(buf);
await file.close();
await client.close();