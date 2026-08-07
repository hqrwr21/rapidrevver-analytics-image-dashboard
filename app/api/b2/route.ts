// app/api/b2/route.ts
import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: process.env.B2_DATA_ENDPOINT,
  region: process.env.B2_REGION || "us-west-004",
  credentials: {
    accessKeyId: process.env.B2_DATA_KEY_ID!,
    secretAccessKey: process.env.B2_DATA_APP_KEY!,
  },
  forcePathStyle: true,
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const folder = searchParams.get('folder');
  const file = searchParams.get('file');

  if (!folder || !file) {
    return new NextResponse("Missing folder or file", { status: 400 });
  }

  try {
    const command = new GetObjectCommand({
      Bucket: process.env.B2_DATA_BUCKET!,
      Key: `${folder}${file}`,
    });

    const response = await s3.send(command);
    
    // Transform the AWS Node stream into a Web stream so the browser can read it
    const stream = response.Body?.transformToWebStream();
    
    return new Response(stream, {
      headers: {
        'Content-Type': response.ContentType || 'application/octet-stream',
      },
    });
  } catch (error) {
    console.error("API Proxy Error:", error);
    return new NextResponse("Failed to fetch file", { status: 500 });
  }
}