export type RoomSlotSettings = {
  threeHourEnabled: boolean
  sixHourEnabled: boolean
  twelveHourEnabled: boolean
  nightStayEnabled: boolean
}

export type CustomerSlotType = 'H3' | 'H6' | 'H12' | 'FULLDAY'

export const ROOM_SLOT_SETTING_FIELDS = {
  H3: 'threeHourEnabled',
  H6: 'sixHourEnabled',
  H12: 'twelveHourEnabled',
  FULLDAY: 'nightStayEnabled',
} as const satisfies Record<CustomerSlotType, keyof RoomSlotSettings>

export function roomAllowsSlotType(room: RoomSlotSettings, slotType: string) {
  if (!(slotType in ROOM_SLOT_SETTING_FIELDS)) return false
  const setting = ROOM_SLOT_SETTING_FIELDS[slotType as CustomerSlotType]
  return room[setting]
}

export function enabledSlotTypesForRoom(room: RoomSlotSettings): CustomerSlotType[] {
  return (Object.keys(ROOM_SLOT_SETTING_FIELDS) as CustomerSlotType[])
    .filter(slotType => roomAllowsSlotType(room, slotType))
}
