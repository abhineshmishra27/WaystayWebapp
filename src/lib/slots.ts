import { SlotType } from '@prisma/client'

type GenerateSlotOptions = {
  roomId: string
  date: string
  startHour?: number
  endHour?: number
  pricePerHour?: number
  priceFullDay?: number
}

const durations = [
  { slotType: 'H3' as const, hours: 3 },
  { slotType: 'H6' as const, hours: 6 },
  { slotType: 'H9' as const, hours: 9 },
  { slotType: 'H12' as const, hours: 12 },
]

export function generateSlotsForRoom(options: GenerateSlotOptions) {
  const { roomId, date, startHour = 8, endHour = 20 } = options
  const slots = [] as Array<{
    roomId: string
    date: string
    slotType: SlotType
    startTime: string
    endTime: string
  }>

  for (const duration of durations) {
    const end = startHour + duration.hours
    if (end <= endHour) {
      slots.push({
        roomId,
        date,
        slotType: duration.slotType,
        startTime: `${String(startHour).padStart(2, '0')}:00`,
        endTime: `${String(end).padStart(2, '0')}:00`,
      })
    }
  }

  slots.push({
    roomId,
    date,
    slotType: 'FULLDAY',
    startTime: `${String(startHour).padStart(2, '0')}:00`,
    endTime: `${String(endHour).padStart(2, '0')}:00`,
  })

  return slots
}
