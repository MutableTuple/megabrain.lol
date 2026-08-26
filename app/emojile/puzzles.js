// Daily emoji puzzles. Cycle through by date so everyone sees the same one each day.
// Category and difficulty for flavor.
export const PUZZLES = [
  { emoji: "🦁👑",       answer: "the lion king",             category: "movie" },
  { emoji: "🕷️🕸️👦",     answer: "spider man",                category: "movie" },
  { emoji: "🌊🚢💔",     answer: "titanic",                   category: "movie" },
  { emoji: "🐟🔍",       answer: "finding nemo",              category: "movie" },
  { emoji: "🍫🏭",       answer: "charlie and the chocolate factory", category: "movie" },
  { emoji: "❄️👸👗",     answer: "frozen",                    category: "movie" },
  { emoji: "🕰️🔫👨",     answer: "pulp fiction",              category: "movie" },
  { emoji: "🧙‍♂️💍🌋",   answer: "the lord of the rings",     category: "movie" },
  { emoji: "🚗🏁",       answer: "cars",                      category: "movie" },
  { emoji: "🐭🍽️🇫🇷",    answer: "ratatouille",               category: "movie" },
  { emoji: "🐋🎣👨‍🦳",   answer: "moby dick",                 category: "book" },
  { emoji: "🎩🐰🍵",     answer: "alice in wonderland",       category: "book" },
  { emoji: "⚡👦📚",     answer: "harry potter",              category: "book" },
  { emoji: "🍎📉👨‍🍳",   answer: "an apple a day",            category: "idiom" },
  { emoji: "☔🐈🐕",     answer: "raining cats and dogs",     category: "idiom" },
  { emoji: "🎂🍰🍰",     answer: "piece of cake",             category: "idiom" },
  { emoji: "🐝🦵",       answer: "bees knees",                category: "idiom" },
  { emoji: "🎯👀",       answer: "eye on the prize",          category: "idiom" },
  { emoji: "🧊🎂",       answer: "icing on the cake",         category: "idiom" },
  { emoji: "🐴🍎",       answer: "big apple",                 category: "phrase" },
  { emoji: "🏰🐭",       answer: "disneyland",                category: "place" },
  { emoji: "🗽🍎",       answer: "new york",                  category: "place" },
  { emoji: "🥐🗼",       answer: "paris",                     category: "place" },
  { emoji: "🍣🗾",       answer: "japan",                     category: "place" },
  { emoji: "🎸🐎🇺🇸",    answer: "country music",             category: "phrase" },
  { emoji: "🍕🍕🐢",     answer: "teenage mutant ninja turtles", category: "movie" },
  { emoji: "👽📞🏠",     answer: "et phone home",             category: "movie" },
  { emoji: "🍔👑",       answer: "burger king",               category: "brand" },
  { emoji: "🐭🏰",       answer: "disney",                    category: "brand" },
  { emoji: "🍎🎵",       answer: "apple music",               category: "brand" },
];

// Deterministic puzzle for a given date (server / client agree)
export function puzzleForDate(date = new Date()) {
  const epoch = new Date(Date.UTC(2024, 0, 1)).getTime();
  const dayIndex = Math.floor((date.getTime() - epoch) / (1000 * 60 * 60 * 24));
  const idx = ((dayIndex % PUZZLES.length) + PUZZLES.length) % PUZZLES.length;
  return { ...PUZZLES[idx], dayNumber: dayIndex + 1 };
}
