// app/actions/b2.ts
"use server";

import { 
  S3Client, PutObjectCommand, ListObjectsV2Command, 
  DeleteObjectCommand, GetObjectCommand 
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Data = new S3Client({
  endpoint: process.env.B2_DATA_ENDPOINT,
  region: process.env.B2_REGION || "us-west-004",
  credentials: {
    accessKeyId: process.env.B2_DATA_KEY_ID!,
    secretAccessKey: process.env.B2_DATA_APP_KEY!,
  },
  forcePathStyle: true,
});

const s3Images = new S3Client({
  endpoint: process.env.B2_IMAGE_ENDPOINT,
  region: process.env.B2_REGION || "us-west-004",
  credentials: {
    accessKeyId: process.env.B2_IMAGE_KEY_ID!,
    secretAccessKey: process.env.B2_IMAGE_APP_KEY!,
  },
  forcePathStyle: true,
});

function getS3Target(folder: string) {
  if (folder.startsWith("images/")) {
    return { client: s3Images, bucket: process.env.B2_IMAGE_BUCKET! };
  }
  return { client: s3Data, bucket: process.env.B2_DATA_BUCKET! };
}

// ==========================================
// 🚀 NATIVE SERVER UPLOAD
// ==========================================
export async function uploadFileToB2(formData: FormData) {
  const file = formData.get("file") as File;
  const folder = formData.get("folder") as string;
  
  const { client, bucket } = getS3Target(folder);
  const buffer = Buffer.from(await file.arrayBuffer());
  
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: `${folder}${file.name}`,
    Body: buffer,
    ContentType: file.type || "application/octet-stream",
  });
  
  await client.send(command);
  return true;
}

export async function listFiles(folder: string) {
  try {
    const { client, bucket } = getS3Target(folder);
    const command = new ListObjectsV2Command({ Bucket: bucket, Prefix: folder });
    const response = await client.send(command);
    return response.Contents?.map((obj) => obj.Key?.replace(folder, "")).filter(Boolean) as string[] || [];
  } catch (error) {
    return [];
  }
}

export async function deleteFileFromB2(fileName: string, folder: string) {
  const { client, bucket } = getS3Target(folder);
  const command = new DeleteObjectCommand({ Bucket: bucket, Key: `${folder}${fileName}` });
  await client.send(command);
  return true;
}

export async function getPresignedDownloadUrl(fileName: string, folder: string) {
  const { client, bucket } = getS3Target(folder);
  const command = new GetObjectCommand({ Bucket: bucket, Key: `${folder}${fileName}` });
  return getSignedUrl(client, command, { expiresIn: 3600 });
}

// ==========================================
// 🔗 GET PUBLIC IMAGE URL (Fixed for Spaces)
// ==========================================
export async function getPublicB2Url(fileName: string, folder: string) {
  const { bucket } = getS3Target(folder);
  const endpoint = folder.startsWith("images/") 
    ? process.env.B2_IMAGE_ENDPOINT 
    : process.env.B2_DATA_ENDPOINT;
  
  // Combine folder and filename, then encode each segment individually
  // This properly formats spaces as %20 and safely handles special characters
  const fullPath = `${folder}${fileName}`;
  const safePath = fullPath.split('/').map(segment => encodeURIComponent(segment)).join('/');
  
  return `${endpoint}/${bucket}/${safePath}`;
}