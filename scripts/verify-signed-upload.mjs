import 'dotenv/config';
import { readFile, stat } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { Upload } from 'tus-js-client';

const supabaseUrl = process.env.SUPABASE_URL;
const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !adminKey) throw new Error('Supabase test configuration is missing.');

const sourcePath = new URL('../assets/brand/intros/morning-devotional-intro.mp4', import.meta.url);
const sourceInfo = await stat(sourcePath);
const sourceBytes = await readFile(sourcePath);
const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
const endpoint = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
const bucket = 'devotional-media';
const objectName = `_system-tests/signed-upload-${Date.now()}.mp4`;
const supabase = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });

let uploaded = false;
try {
  await new Promise((resolve, reject) => {
    const upload = new Upload(sourceBytes, {
      endpoint,
      uploadSize: sourceInfo.size,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000],
      headers: { authorization: `Bearer ${adminKey}` },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName,
        contentType: 'video/mp4',
        cacheControl: '60'
      },
      onError(error) {
        const body = error?.originalResponse?.getBody?.();
        reject(new Error(body || 'The authenticated resumable upload failed.'));
      },
      onSuccess: resolve
    });
    upload.start();
  });
  uploaded = true;

  const { data: info, error: infoError } = await supabase.storage.from(bucket).info(objectName);
  if (infoError || !info || info.size !== sourceInfo.size) throw infoError || new Error('Uploaded byte count did not match.');
  console.log(`Authenticated resumable upload verified: ${info.size} bytes`);
} finally {
  if (uploaded) {
    const { error: removeError } = await supabase.storage.from(bucket).remove([objectName]);
    if (removeError) throw removeError;
    console.log('Temporary storage test copy removed.');
  }
}
