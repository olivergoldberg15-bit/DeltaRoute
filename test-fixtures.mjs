/** Test-only scratch root; override when a host sandbox restricts ordinary TEMP. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const testTempRoot=path.resolve(process.env.DELTAROUTE_TEST_TMP||os.tmpdir());
fs.mkdirSync(testTempRoot,{recursive:true});
