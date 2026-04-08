/**
 * Short quotes paired with each saved pot (snapshot at save time).
 */
export const POT_QUOTES = [
  { text: 'The clay remembers every touch.', author: 'Studio proverb' },
  { text: 'I threw pots before I knew I was a potter.', author: 'Beatrice Wood' },
  { text: 'Earth, water, fire—patience is the fourth element.', author: 'Anonymous' },
  { text: 'A pot is a pause between two silences.', author: 'Anonymous' },
  { text: 'What the hand does, the heart remembers.', author: 'Chinese proverb' },
  { text: 'The wheel turns; the mind stills.', author: 'Anonymous' },
  { text: 'Clay is the most forgiving critic—it lets you begin again.', author: 'Anonymous' },
  { text: 'Every crack is a conversation.', author: 'Kintsugi spirit' },
  { text: 'Form follows the finger’s wish.', author: 'Anonymous' },
  { text: 'The kiln finishes what the hands propose.', author: 'Anonymous' },
  { text: 'To center clay is to find your own center.', author: 'Anonymous' },
  { text: 'A bowl is a circle that learned to hold.', author: 'Anonymous' },
  { text: 'Glaze is a promise the fire must keep.', author: 'Anonymous' },
  { text: 'The potter leaves fingerprints the world can’t see.', author: 'Anonymous' },
  { text: 'Soft earth, stubborn idea.', author: 'Anonymous' },
  { text: 'Throwing is listening with your palms.', author: 'Anonymous' },
  { text: 'What breaks can still be beautiful.', author: 'Japanese craft wisdom' },
  { text: 'The vessel is empty so it can be useful.', author: 'after Lao Tzu' },
  { text: 'Heat reveals what water hid.', author: 'Anonymous' },
  { text: 'Each ring on the wheel is a small oath.', author: 'Anonymous' },
  { text: 'Mud and ambition: an ancient friendship.', author: 'Anonymous' },
  { text: 'The lip of the cup is where thirst meets design.', author: 'Anonymous' },
  { text: 'Craft is curiosity that stayed for dinner.', author: 'Anonymous' },
  { text: 'Spin slow; the clay is teaching.', author: 'Anonymous' },
  { text: 'A vase is a sky held sideways.', author: 'Anonymous' },
  { text: 'Foot, belly, shoulder, neck—poetry in parts.', author: 'Anonymous' },
  { text: 'The first fire is hope; the second is truth.', author: 'Anonymous' },
  { text: 'Hands think in spirals.', author: 'Anonymous' },
  { text: 'Beauty is optional; usefulness is negotiable; presence is enough.', author: 'Anonymous' },
  { text: 'From dust, a curve; from a curve, a home for tea.', author: 'Anonymous' },
  { text: 'The studio smells like tomorrow.', author: 'Anonymous' },
  { text: 'Weight in the hand is honesty.', author: 'Anonymous' },
  { text: 'Trimming is editing with a blade.', author: 'Anonymous' },
  { text: 'Coil by coil, the wall rises anyway.', author: 'Anonymous' },
  { text: 'Silica, soda, lime—a sentence in chemistry.', author: 'Anonymous' },
  { text: 'The pot outlives the argument you had while making it.', author: 'Anonymous' },
  { text: 'Touch the rim twice: once to test, once to thank.', author: 'Anonymous' },
  { text: 'Digital or clay—shape is still a decision.', author: 'Anonymous' },
];

export function pickPotQuote() {
  const i = Math.floor(Math.random() * POT_QUOTES.length);
  const { text, author } = POT_QUOTES[i];
  return { text, author };
}
