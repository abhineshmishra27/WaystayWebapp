output "maps_dev_api_key" {
  description = "Set this as GOOGLE_MAPS_API_KEY in local development only."
  value       = google_apikeys_key.maps_dev_key.key_string
  sensitive   = true
}

output "maps_prod_api_key" {
  description = "Set this as GOOGLE_MAPS_API_KEY in Vercel production only."
  value       = google_apikeys_key.maps_prod_key.key_string
  sensitive   = true
}
