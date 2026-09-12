provider "google" {
  project               = var.project_id
  billing_project       = var.project_id
  user_project_override = true
}

# Required by the server-side dhaba discovery integration.
resource "google_project_service" "routes_api" {
  project            = var.project_id
  service            = "routes.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "places_api" {
  project            = var.project_id
  service            = "places.googleapis.com"
  disable_on_destroy = false
}

# This management API is required to create and manage API keys through
# Terraform. It is separate from the APIs that the keys themselves may call.
resource "google_project_service" "api_keys_api" {
  project            = var.project_id
  service            = "apikeys.googleapis.com"
  disable_on_destroy = false
}

# These are server-only keys. They are restricted to the two Maps services,
# and are deliberately not given a fixed-IP restriction while Waystay uses
# Vercel's dynamic function egress addresses.
resource "google_apikeys_key" "maps_dev_key" {
  name            = "maps-dev-key"
  display_name    = "Maps Dev Key"
  project         = var.project_id
  deletion_policy = "PREVENT"

  restrictions {
    api_targets {
      service = "routes.googleapis.com"
    }

    api_targets {
      service = "places.googleapis.com"
    }
  }

  depends_on = [
    google_project_service.routes_api,
    google_project_service.places_api,
    google_project_service.api_keys_api,
  ]
}

resource "google_apikeys_key" "maps_prod_key" {
  name            = "maps-prod-key"
  display_name    = "Maps Prod Key"
  project         = var.project_id
  deletion_policy = "PREVENT"

  restrictions {
    api_targets {
      service = "routes.googleapis.com"
    }

    api_targets {
      service = "places.googleapis.com"
    }
  }

  depends_on = [
    google_project_service.routes_api,
    google_project_service.places_api,
    google_project_service.api_keys_api,
  ]
}
