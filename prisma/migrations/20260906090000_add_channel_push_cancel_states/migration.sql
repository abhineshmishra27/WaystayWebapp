-- A cancelled channel booking must be distinguishable from one still holding a room,
-- and a cancellation the channel was never told about needs chasing rather than
-- looking successful.
ALTER TYPE "ChannelPushStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "ChannelPushStatus" ADD VALUE IF NOT EXISTS 'CANCEL_FAILED';
