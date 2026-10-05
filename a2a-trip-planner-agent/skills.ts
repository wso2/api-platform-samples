/** What a skill produced: one reply, or a sequence to stream. */
export type SkillResult =
  | { kind: 'text'; text: string }
  | { kind: 'stream'; chunks: string[] };

const HELP = [
  'Trip Planning Agent. Commands:',
  '  flights <from> <to>      search flights between two airports',
  '  hotels <city>            search hotels in a city',
  '  book <id>                book a flight or hotel from a search result',
  '  itinerary <city> <days>  build a day by day plan',
  '',
  'For example: flights LHR CMB',
].join('\n');

/**
 * A stable number derived from the input, so the same search always returns
 * the same results and the same booking always returns the same reference.
 */
function seed(text: string): number {
  let value = 0;
  for (const char of text.toUpperCase()) {
    value = (value * 31 + char.charCodeAt(0)) >>> 0;
  }
  return value;
}

function bookingReference(id: string): string {
  return `TP-${seed(id).toString(16).toUpperCase().padStart(6, '0').slice(0, 6)}`;
}

function clockTime(hour: number, minute: number): string {
  return `${String(hour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const CARRIERS = ['UL', 'EK', 'QR'];

interface Flight {
  id: string;
  depart: string;
  arrive: string;
  price: number;
}

function searchFlights(from: string, to: string): Flight[] {
  const base = seed(from + to);
  return CARRIERS.map((carrier, index) => {
    // Unsigned throughout: the seed exceeds 2^31, and the durations derived
    // from it have to stay positive for an arrival to follow its departure.
    const offset = (base + index * 977) >>> 0;
    const departHour = 6 + (offset % 15);
    const departMinute = (offset % 4) * 15;
    const durationHours = 3 + ((offset >>> 3) % 10);
    const arriveHour = departHour + durationHours;
    return {
      id: `${carrier}${100 + (offset % 800)}`,
      depart: clockTime(departHour, departMinute),
      arrive: clockTime(arriveHour, departMinute) + (arriveHour >= 24 ? '+1' : ''),
      price: 320 + (offset % 680),
    };
  });
}

const HOTEL_STYLES = ['Grand', 'Harbour', 'Garden'];

interface Hotel {
  id: string;
  name: string;
  rating: number;
  pricePerNight: number;
}

function searchHotels(city: string): Hotel[] {
  const base = seed(city);
  const slug = city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return HOTEL_STYLES.map((style, index) => {
    const offset = (base + index * 613) >>> 0;
    return {
      id: `${style.toLowerCase()}-${slug}`,
      name: `${style} ${city}`,
      rating: 3 + (offset % 3),
      pricePerNight: 70 + (offset % 240),
    };
  });
}

const ACTIVITIES = [
  'a walking tour of the old town',
  'the museum of local history',
  'lunch at the harbour market',
  'the botanical gardens',
  'the sunset viewpoint',
  'the street food district',
  'a day trip along the coast',
];

/** Resolves a search-result id to its confirmation, or undefined if it is neither. */
function confirmBooking(id: string): string | undefined {
  const flightId = id.toUpperCase();
  if (/^[A-Z]{2}\d{3}$/.test(flightId)) {
    return (
      `Flight ${flightId} booked. Reference ${bookingReference(flightId)}. ` +
      'Check-in opens 24 hours before departure.'
    );
  }
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(id)) {
    const name = id
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return (
      `${name} booked. Reference ${bookingReference(id)}. ` +
      'Free cancellation until 48 hours before arrival.'
    );
  }
  return undefined;
}

/**
 * Selects a skill from the first word of the message. A2A carries free text,
 * so the command is positional and the rest of the message is its argument.
 */
export function runSkill(text: string): SkillResult {
  const trimmed = text.trim();
  const separator = trimmed.indexOf(' ');
  const command = (separator === -1 ? trimmed : trimmed.slice(0, separator)).toLowerCase();
  const args = (separator === -1 ? '' : trimmed.slice(separator + 1))
    .split(/\s+/)
    .filter(Boolean);

  switch (command) {
    case 'flights': {
      if (args.length !== 2) {
        return {
          kind: 'text',
          text: 'flights needs an origin and a destination, for example: flights LHR CMB',
        };
      }
      const [from, to] = args.map((code) => code.toUpperCase());
      const rows = searchFlights(from, to).map(
        (flight) => `  ${flight.id}  ${flight.depart} → ${flight.arrive}   USD ${flight.price}`
      );
      return {
        kind: 'text',
        text: [`Flights ${from} → ${to}`, ...rows, '', 'Book one with: book <flight id>'].join('\n'),
      };
    }

    case 'hotels': {
      if (args.length === 0) {
        return { kind: 'text', text: 'hotels needs a city, for example: hotels Colombo' };
      }
      const city = args.join(' ');
      const rows = searchHotels(city).map(
        (hotel) =>
          `  ${hotel.id}  ${hotel.name}  ${'★'.repeat(hotel.rating)}  USD ${hotel.pricePerNight}/night`
      );
      return {
        kind: 'text',
        text: [`Hotels in ${city}`, ...rows, '', 'Book one with: book <hotel id>'].join('\n'),
      };
    }

    case 'book': {
      if (args.length !== 1) {
        return {
          kind: 'text',
          text: 'book needs one id from a search result, for example: book UL504',
        };
      }
      return {
        kind: 'text',
        text:
          confirmBooking(args[0]) ??
          `No flight or hotel matches "${args[0]}". Search first with: flights <from> <to>, or hotels <city>`,
      };
    }

    case 'itinerary': {
      const days = Number(args[args.length - 1]);
      const city = args.slice(0, -1).join(' ');
      if (!city || !Number.isInteger(days) || days < 1 || days > 7) {
        return {
          kind: 'text',
          text: 'itinerary needs a city and a number of days from 1 to 7, for example: itinerary Colombo 3',
        };
      }
      const base = seed(city);
      // One chunk per day, so a longer trip streams for longer.
      const chunks = Array.from({ length: days }, (_, index) => {
        const morning = ACTIVITIES[(base + index * 2) % ACTIVITIES.length];
        const evening = ACTIVITIES[(base + index * 2 + 1) % ACTIVITIES.length];
        return `Day ${index + 1} in ${city}: ${morning}, then ${evening}.`;
      });
      return { kind: 'stream', chunks };
    }

    default:
      return { kind: 'text', text: HELP };
  }
}
