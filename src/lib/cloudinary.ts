import { v2 as cloudinary } from 'cloudinary'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

export default cloudinary

export async function uploadImage(
  fileBuffer: Buffer,
  mimeType: string,
  folder: string
): Promise<{ url: string; publicId: string }> {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
  if (!allowedTypes.includes(mimeType)) {
    throw new Error('Only JPEG, PNG, and WebP images are allowed')
  }

  const base64 = fileBuffer.toString('base64')
  const dataUri = `data:${mimeType};base64,${base64}`

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: `waystayy/${folder}`,
    resource_type: 'image',
    transformation: [
      { width: 1200, crop: 'limit' },
      { quality: 'auto' },
      { format: 'auto' },
    ],
  })

  return { url: result.secure_url, publicId: result.public_id }
}

export async function deleteImage(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId)
}
