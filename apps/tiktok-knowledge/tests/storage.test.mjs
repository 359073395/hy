import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
const storageModule = await import('../src/lib/storage.ts');
const {
  deleteObject, readUploadPart, resolveStagedParts, resolveStoragePath,
  stagingPartKey, storeUploadPart, uploadMaterial, uploadMaterialFromParts,
} = storageModule.default ?? storageModule;

test('local attachment persistence, retry, multipart integrity and path containment', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowledge-storage-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  try {
    const image = await uploadMaterial(Buffer.from('test-image'), 'example.png', 'image/png');
    assert.match(image.url, /^\/api\/files\/materials\/[\da-f-]+\.png$/);
    assert.equal(await readFile(await resolveStoragePath(image.key), 'utf8'), 'test-image');
    for (const unsafe of ['materials/../outside', 'materials/..\\outside', '/etc/passwd', 'materials/%2e%2e/test', 'unknown/file']) {
      await assert.rejects(resolveStoragePath(unsafe));
    }

    const uploadId = randomUUID();
    const first = stagingPartKey(uploadId, 0);
    const second = stagingPartKey(uploadId, 1);
    await storeUploadPart(first, Buffer.from('old'));
    await storeUploadPart(first, Buffer.from('abc'));
    assert.equal(await resolveStagedParts(uploadId, 2), null);
    await storeUploadPart(second, Buffer.from('def'));
    const keys = await resolveStagedParts(uploadId, 2);
    assert.deepEqual(keys, [first, second]);
    const combined = await uploadMaterialFromParts({
      fileName: 'video.mp4', contentType: 'video/mp4', totalBytes: 6, partCount: 2,
      readPart: (index) => readUploadPart(keys[index]),
    });
    assert.equal(await readFile(await resolveStoragePath(combined.key), 'utf8'), 'abcdef');
    const before = (await readdir(path.join(directory, 'materials'))).sort();
    await assert.rejects(uploadMaterialFromParts({
      fileName: 'video.mp4', contentType: 'video/mp4', totalBytes: 5, partCount: 2,
      readPart: (index) => readUploadPart(keys[index]),
    }), /大小/);
    assert.deepEqual((await readdir(path.join(directory, 'materials'))).sort(), before);
    await Promise.all(keys.map(deleteObject));
    assert.equal(await resolveStagedParts(uploadId, 2), null);

    const link = path.join(directory, 'materials', 'outside');
    await symlink(os.tmpdir(), link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(resolveStoragePath('materials/outside/file'), /Symbolic/);
    await deleteObject(image.key);
    await assert.rejects(readFile(await resolveStoragePath(image.key)), { code: 'ENOENT' });
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
