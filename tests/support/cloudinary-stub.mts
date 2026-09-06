/**
 * Stands in for `@/lib/cloudinary` during route tests.
 *
 * Image ingestion asks Cloudinary to fetch a remote URL. Letting that happen in tests
 * would mean real uploads against real credentials, into the account the product uses,
 * for images that do not exist. The stub records what would have been uploaded and
 * hands back a plausible secure URL, so the pipeline either side of it is exercised for
 * real while nothing leaves the machine.
 */

export type StubUpload = { source: string; publicId: string }

export const uploads: StubUpload[] = []

/** Set to make the next upload throw, exercising the partial-failure path. */
export const control = { failNextUpload: false, failAllUploads: false }

export function resetCloudinaryStub() {
  uploads.length = 0
  control.failNextUpload = false
  control.failAllUploads = false
}

const uploader = {
  async upload(source: string, options: { public_id?: string } = {}) {
    if (control.failAllUploads || control.failNextUpload) {
      control.failNextUpload = false
      throw new Error('cloudinary refused the upload')
    }
    const publicId = options.public_id ?? `waystayy/generated/${uploads.length}`
    uploads.push({ source, publicId })
    return {
      secure_url: `https://res.cloudinary.com/demo/image/upload/${publicId}.jpg`,
      public_id: publicId,
    }
  },
  async destroy(publicId: string) {
    return { result: 'ok', public_id: publicId }
  },
}

const cloudinary = { uploader, config: () => ({}) }
export default cloudinary

export async function uploadImage() {
  throw new Error('uploadImage is not stubbed for route tests')
}

export async function deleteImage() {
  return undefined
}
