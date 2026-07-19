import 'dotenv/config';
import { readFile, stat } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const adminKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !adminKey) throw new Error('Supabase test configuration is missing.');

const sourcePath = new URL('../assets/brand/intros/morning-devotional-intro.mp4', import.meta.url);
const sourceInfo = await stat(sourcePath);
const sourceBytes = await readFile(sourcePath);
const bucket = 'devotional-media';
const objectName = `_system-tests/signed-upload-${Date.now()}.mp4`;
const supabase = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });

let uploaded = false;
try {
  const { data: signed, error: signedError } = await supabase.storage.from(bucket).createSignedUploadUrl(objectName);
  if (signedError || !signed?.token) throw signedError || new Error('No signed upload token was returned.');

  const { error: uploadError } = await supabase.storage.from(bucket).uploadToSignedUrl(
    objectName,
    signed.token,
    sourceBytes,
    { contentType: 'video/mp4', cacheControl: '60' }
  );
  if (uploadError) throw uploadError;
  uploaded = true;

  const { data: info, error: infoError } = await supabase.storage.from(bucket).info(objectName);
  if (infoError || !info || info.size !== sourceInfo.size) throw infoError || new Error('Uploaded byte count did not match.');
  console.log(`Signed upload verified: ${info.size} bytes`);
} finally {
  if (uploaded) {
    const { error: removeError } = await supabase.storage.from(bucket).remove([objectName]);
    if (removeError) throw removeError;
    console.log('Temporary storage test copy removed.');
  }
}
