import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function distanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function findNearestHelpers(pickupLat: number, pickupLng: number) {
  const helpers = await prisma.helper.findMany({
    where: {
      isApproved: true,
      isOnline: true,
      latitude: { not: null },
      longitude: { not: null },
    },
    include: {
      user: true,
    },
  });

  const ranked = helpers
    .map((helper) => {
      const latitude = helper.latitude ?? 0;
      const longitude = helper.longitude ?? 0;

      return {
        ...helper,
        distanceMiles: distanceMiles(
          pickupLat,
          pickupLng,
          latitude,
          longitude
        ),
      };
    })
    .filter((helper) => helper.distanceMiles <= helper.maxRadiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  return ranked;
}