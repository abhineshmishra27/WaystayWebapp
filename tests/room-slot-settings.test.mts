import assert from 'node:assert/strict'
import test from 'node:test'
import { generateSlotsForRoom } from '../src/lib/slots.ts'
import { enabledSlotTypesForRoom, roomAllowsSlotType, type RoomSlotSettings } from '../src/lib/room-slot-settings.ts'

const settings: RoomSlotSettings = {
  threeHourEnabled: false,
  sixHourEnabled: true,
  twelveHourEnabled: false,
  nightStayEnabled: true,
}

test('each room stay duration can be enabled independently', () => {
  assert.equal(roomAllowsSlotType(settings, 'H3'), false)
  assert.equal(roomAllowsSlotType(settings, 'H6'), true)
  assert.equal(roomAllowsSlotType(settings, 'H12'), false)
  assert.equal(roomAllowsSlotType(settings, 'FULLDAY'), true)
  assert.equal(roomAllowsSlotType(settings, 'H9'), false)
})

test('enabled slot types preserve the room-level settings', () => {
  assert.deepEqual(enabledSlotTypesForRoom(settings), ['H6', 'FULLDAY'])
})

test('slot generation only creates enabled durations', () => {
  const slots = generateSlotsForRoom({
    roomId: 'room-1',
    date: '2026-08-24',
    startHour: 6,
    endHour: 18,
    enabledSlotTypes: enabledSlotTypesForRoom(settings),
  })

  assert.deepEqual(slots.map(slot => slot.slotType), ['H6', 'FULLDAY'])
})
