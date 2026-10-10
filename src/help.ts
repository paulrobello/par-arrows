/**
 * The settings panel's mechanics guide. Each entry is one game mechanic with
 * the authored cube that introduces it; a mechanic appears in Settings once
 * the campaign save has unlocked that cube, so players only read about what
 * they have actually met.
 */
export interface MechanicHelp {
  readonly id: string;
  readonly title: string;
  /** The authored intro cube that first shows this mechanic. */
  readonly unlockLevel: number;
  readonly description: string;
}

export const MECHANIC_HELP: readonly MechanicHelp[] = [
  {
    id: "arrows",
    title: "Arrows",
    unlockLevel: 1,
    description:
      "Tap an arrow with a clear lane and it flies off the cube. A blocked lane collides: the first collision costs a life and turns the arrow red, and retries are free.",
  },
  {
    id: "stop",
    title: "Stop circles",
    unlockLevel: 5,
    description:
      "Green circles are parking spots. A head that reaches one stops there for free; tap the arrow again to send it onward.",
  },
  {
    id: "wrap",
    title: "Wrapping edges",
    unlockLevel: 11,
    description:
      "Yellow edges don't end a flight — they carry the arrow onto the neighboring face.",
  },
  {
    id: "overlap",
    title: "Shared tails",
    unlockLevel: 15,
    description:
      "Arrows that share a tail fly as one group. Tap any member to launch them all together, and a blocked group reverses as one.",
  },
  {
    id: "directional",
    title: "Directional spots",
    unlockLevel: 20,
    description:
      "Cyan chevrons bend the road. A head that reaches one turns onto the chevron's heading, letting it leave a blocked lane and release other arrows.",
  },
  {
    id: "double",
    title: "Two-headed arrows",
    unlockLevel: 25,
    description:
      "A violet and a lime half share one body, and each half moves toward its own head — picking a half chooses the direction.",
  },
  {
    id: "flip",
    title: "Flip spots",
    unlockLevel: 30,
    description:
      "Magenta spots flip their direction once an arrow has fully passed. A head-on meeting reverses the arrow back over its own body.",
  },
  {
    id: "wormhole",
    title: "Wormholes",
    unlockLevel: 35,
    description:
      "Paired rings join two faces: a head entering one comes out of the matching ring, still heading the same way.",
  },
  {
    id: "rotor",
    title: "Rotor spots",
    unlockLevel: 40,
    description:
      "Amber rotors turn a quarter clockwise once the whole arrow has passed. A head-on approach reverses; read the new heading and clear any body holding the next approach.",
  },
  {
    id: "fragile",
    title: "Fragile cells",
    unlockLevel: 45,
    description:
      "Cracked cells hold for one crossing, then collapse into a hole. A head that runs into the hole falls into the cube and costs a life.",
  },
  {
    id: "lock",
    title: "Keys and gates",
    unlockLevel: 50,
    description:
      "A barred gate stops an arrow for free, at no life, until any arrow crosses its key elsewhere on the cube. Keys open their gate for good.",
  },
  {
    id: "mirror",
    title: "Mirrors",
    unlockLevel: 55,
    description:
      "A silver mirror reflects a head across its diagonal. North can turn east and east can turn north; check the reflected exit for bodies before sending the next approach.",
  },
  {
    id: "leap",
    title: "Leap pads",
    unlockLevel: 60,
    description:
      "Amber leap pads skip the next cell: the head lands two cells on and nothing on the skipped cell ever triggers.",
  },
];

/** Thumbnail for one mechanic, served from the app's static assets. */
export function mechanicImagePath(id: string): string {
  return `/help/${id}.png`;
}

/** Mechanics whose intro cube the player has reached, in meeting order. */
export function encounteredMechanics(
  unlockedLevelId: number,
): readonly MechanicHelp[] {
  return MECHANIC_HELP.filter(
    (mechanic) => unlockedLevelId >= mechanic.unlockLevel,
  );
}
