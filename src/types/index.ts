import type { User, Hotel, Room, RoomSlot, Booking, Payment, Review, Restaurant, MenuItem } from '@prisma/client'

export type UserWithoutPassword = Omit<User, 'passwordHash'>

export type HotelWithImages = Hotel & {
  images: import('@prisma/client').HotelImage[]
  _count?: { reviews: number }
  avgRating?: number
}

export type HotelWithDetails = Hotel & {
  images: import('@prisma/client').HotelImage[]
  rooms: RoomWithSlotCount[]
  reviews: ReviewWithCustomer[]
  restaurant: RestaurantWithMenu | null
  owner: { name: string }
  avgRating: number
  _count: { reviews: number }
}

export type RoomWithSlotCount = Room & {
  _count: { slots: number }
}

export type BookingWithDetails = Booking & {
  roomSlot: RoomSlot & {
    room: Room & {
      hotel: Pick<Hotel, 'id' | 'name' | 'address' | 'city'>
    }
  }
  payment: Payment | null
  extensions: import('@prisma/client').BookingExtension[]
  review: Review | null
}

export type ReviewWithCustomer = Review & {
  customer: Pick<User, 'name' | 'avatarUrl'>
  media: import('@prisma/client').ReviewMedia[]
}

export type RestaurantWithMenu = Restaurant & {
  menuItems: MenuItem[]
}
