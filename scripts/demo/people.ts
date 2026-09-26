/**
 * Invented shoppers, places and words for the demo dataset. Names are common
 * Indian (mostly Gujarati) given and family names combined at random; they
 * describe no real person. Cities, localities and pincode ranges are real, so
 * the delivery-area and GST logic treats them exactly as it would a live order.
 */

export const FIRST_NAMES_F = [
  "Hetal", "Khushi", "Priya", "Riddhi", "Nidhi", "Krupa", "Janvi", "Dhruvi", "Pooja", "Mansi", "Foram", "Bhoomi",
  "Hiral", "Komal", "Shruti", "Aarti", "Kinjal", "Payal", "Vaishali", "Twinkle", "Isha", "Neha", "Ananya", "Sneha",
  "Rupal", "Devanshi", "Urvi", "Zeel", "Aditi", "Meera", "Sana", "Farah", "Kavya", "Tanvi", "Jinal", "Nirali",
];
export const FIRST_NAMES_M = [
  "Harsh", "Parth", "Dhaval", "Kunal", "Jay", "Nirav", "Chirag", "Mihir", "Darshan", "Hardik", "Keyur", "Viral",
  "Bhavin", "Rohan", "Yash", "Sagar", "Ankit", "Ketan", "Jignesh", "Rahul", "Aarav", "Vivaan", "Kabir", "Imran",
  "Faisal", "Arjun", "Pranav", "Sahil", "Tushar", "Utsav", "Devang", "Maulik",
];
export const LAST_NAMES = [
  "Patel", "Shah", "Desai", "Mehta", "Joshi", "Trivedi", "Parmar", "Chauhan", "Solanki", "Vyas", "Bhatt", "Pandya",
  "Rathod", "Makwana", "Thakkar", "Dave", "Amin", "Kapadia", "Gohil", "Jadeja", "Raval", "Soni", "Panchal", "Modi",
  "Doshi", "Sheth", "Parekh", "Vora", "Kothari", "Jain", "Agarwal", "Iyer", "Nair", "Sheikh", "Mansuri", "Fernandes",
];
export const EMAIL_DOMAINS: readonly (readonly [string, number])[] = [
  ["gmail.com", 70], ["yahoo.co.in", 9], ["outlook.com", 7], ["hotmail.com", 4], ["rediffmail.com", 3], ["icloud.com", 4], ["yahoo.com", 3],
];

/** Real Gujarat cities, weighted roughly by online-order share, with real pincode ranges and localities. */
export const CITIES: readonly {
  city: string; weight: number; pins: readonly [number, number]; areas: readonly string[];
}[] = [
  { city: "Ahmedabad", weight: 34, pins: [380001, 380061], areas: ["Satellite", "Bodakdev", "Vastrapur", "Navrangpura", "Maninagar", "Prahlad Nagar", "Thaltej", "Chandkheda", "Bopal", "Paldi", "Naranpura", "Gota"] },
  { city: "Surat", weight: 18, pins: [395001, 395017], areas: ["Adajan", "Vesu", "Piplod", "Athwa", "Pal", "Varachha", "Katargam", "Citylight"] },
  { city: "Vadodara", weight: 12, pins: [390001, 390025], areas: ["Alkapuri", "Gotri", "Manjalpur", "Akota", "Karelibaug", "Vasna Road", "Fatehgunj"] },
  { city: "Rajkot", weight: 9, pins: [360001, 360007], areas: ["Kalawad Road", "Yagnik Road", "Raiya Road", "University Road", "Mavdi"] },
  { city: "Gandhinagar", weight: 6, pins: [382010, 382030], areas: ["Sector 21", "Sector 7", "Kudasan", "Raysan", "Sargasan"] },
  { city: "Bhavnagar", weight: 4, pins: [364001, 364006], areas: ["Waghawadi Road", "Kalubha Road", "Sardarnagar"] },
  { city: "Jamnagar", weight: 4, pins: [361001, 361008], areas: ["Patel Colony", "Digvijay Plot", "Park Colony"] },
  { city: "Anand", weight: 3, pins: [388001, 388001], areas: ["Vidyanagar Road", "Grid Chowkdi", "Lambhvel Road"] },
  { city: "Navsari", weight: 2, pins: [396445, 396445], areas: ["Lunsikui", "Kaliawadi", "Dudhia Talav"] },
  { city: "Bharuch", weight: 2, pins: [392001, 392001], areas: ["Zadeshwar Road", "Link Road", "Station Road"] },
  { city: "Vapi", weight: 2, pins: [396191, 396195], areas: ["Chala", "GIDC", "Koparli Road"] },
  { city: "Junagadh", weight: 2, pins: [362001, 362002], areas: ["Zanzarda Road", "Motibaug", "Talav Darwaja"] },
  { city: "Mehsana", weight: 1, pins: [384002, 384002], areas: ["Modhera Road", "Radhanpur Road"] },
  { city: "Nadiad", weight: 1, pins: [387001, 387002], areas: ["College Road", "Pij Road"] },
];

export const BUILDING_WORDS = ["Shivalik", "Sarthak", "Shaligram", "Shreeji", "Sunrise", "Parishram", "Akshar", "Vrundavan", "Gokul", "Samarpan", "Shilp", "Aaryan", "Swaminarayan", "Ganesh", "Pushpak", "Madhuvan", "Nandanvan", "Sahajanand"];
export const BUILDING_KINDS = ["Residency", "Apartments", "Heights", "Society", "Park", "Bungalows", "Tower", "Complex", "Flats", "Enclave"];

/** Courier partners and their AWB shapes. */
export const COURIERS: readonly { name: string; weight: number; awb: (r: () => number) => string }[] = [
  { name: "Delhivery", weight: 45, awb: (r) => String(Math.floor(1_000_000_000_000 + r() * 8_999_999_999_999)) },
  { name: "Blue Dart", weight: 15, awb: (r) => String(Math.floor(10_000_000_000 + r() * 89_999_999_999)) },
  { name: "Ekart", weight: 15, awb: (r) => `FMPP${Math.floor(1_000_000_000 + r() * 8_999_999_999)}` },
  { name: "DTDC", weight: 12, awb: (r) => `D${Math.floor(10_000_000 + r() * 89_999_999)}` },
  { name: "Shree Maruti Courier", weight: 13, awb: (r) => `SMC${Math.floor(100_000_000 + r() * 899_999_999)}` },
];

/* ---------------------------------------------------------------- reviews */

export type ReviewKind = "namkeen" | "sweet" | "munchies" | "hamper" | "women" | "kids" | "men";

/**
 * Written as customers write: short, specific, sometimes critical. `only`
 * limits a review to the products it actually describes (one mentioning dates
 * goes on the date laddoo, not the sukhdi).
 */
export interface ReviewText { readonly rating: number; readonly text: string; readonly only?: readonly string[] }
const t = (rating: number, text: string, only?: string[]): ReviewText => ({ rating, text, only });

export const REVIEWS: Record<ReviewKind, readonly ReviewText[]> = {
  namkeen: [
    t(5, "Finally a namkeen I don't feel guilty about. The masala is spot on, not too spicy.", ["roasted-masala-makhana", "roasted-chana-jor-garam", "nylon-poha-chevdo"]),
    t(5, "Ordered twice already. My parents love it with evening tea."),
    t(4, "Very crunchy and fresh. Would love a bigger pack size."),
    t(5, "Tastes homemade. Reminds me of what my ba used to make for Diwali.", ["baked-ragi-chakli", "nylon-poha-chevdo", "methi-khakhra-crisps"]),
    t(4, "Good taste, reached Surat in two days. Packaging could be a bit sturdier."),
    t(3, "Taste is nice but slightly salty for me. Will try the other flavours."),
    t(5, "Perfect office snack. Light and doesn't leave oil on your fingers."),
    t(4, "Kids finished the pack in a day! Ordering the bigger combo next time."),
    t(2, "Packet arrived a little crushed. Taste was good though, support team was helpful."),
    t(5, "Best roasted snack I've found online. The ingredient list is short and clear."),
    t(4, "Nice balance of spice and tang. Goes well with chai.", ["roasted-chana-jor-garam", "jowar-puffs-peri-peri", "roasted-masala-makhana"]),
    t(5, "Bought for my parents as a lighter evening snack and they enjoy it. Will reorder."),
  ],
  sweet: [
    t(5, "No refined sugar and it still tastes like proper mithai. Amazed."),
    t(5, "Soft, fresh, and the cardamom is lovely. Perfect with coffee after dinner.", ["date-almond-laddoo", "millet-nankhatai"]),
    t(4, "Really good, but a little on the sweeter side because of the dates.", ["date-almond-laddoo"]),
    t(5, "Sent these to my in-laws in Rajkot, they asked where I bought them."),
    t(3, "Taste is good, but pieces were smaller than I expected for the price."),
    t(5, "Made with ghee you can actually taste. Very authentic.", ["date-almond-laddoo", "jaggery-sukhdi-bites", "millet-nankhatai"]),
    t(4, "Nice festive treat. Arrived well packed before the weekend."),
    t(5, "My go-to for a small sweet craving without feeling heavy."),
    t(5, "Snaps perfectly, just like the chikki we buy for Uttarayan.", ["til-chikki-squares"]),
  ],
  munchies: [
    t(5, "Crispy and not greasy at all. The colour of the chips is beautiful.", ["beetroot-sweet-potato-chips"]),
    t(4, "Great for movie nights. Wish there were more in a pack."),
    t(5, "Healthy and actually tasty, which is rare. It's my desk-drawer staple now.", ["trail-mix-desi-edition", "roasted-peanuts-lemon-pudina"]),
    t(4, "Liked it a lot. Slightly pricey but the quality shows."),
    t(3, "Decent. The cheese flavour could be stronger.", ["quinoa-puffs-cheese-herbs"]),
    t(5, "My kids' new favourite tiffin snack. Nothing weird in the ingredients."),
    t(5, "Really fresh batch, best-before date was months away. Appreciate that."),
    t(4, "Good crunch, balanced salt. Will buy again.", ["beetroot-sweet-potato-chips", "quinoa-puffs-cheese-herbs", "roasted-peanuts-lemon-pudina", "trail-mix-desi-edition"]),
    t(4, "Rich dark chocolate, not too sweet. Keep it in the fridge in summer.", ["dark-chocolate-makhana"]),
  ],
  hamper: [
    t(5, "Gifted this for Raksha Bandhan and my brother loved it. Beautiful box.", ["rakhi-snack-hamper"]),
    t(5, "Ordered 12 crates for client gifting. Delivered on time and looked premium.", ["corporate-wellness-crate"]),
    t(4, "Lovely hamper, everything fresh. The card was a nice touch.", ["rakhi-snack-hamper"]),
    t(5, "The box itself is reusable, which I really liked. Great variety inside.", ["rakhi-snack-hamper", "festive-mithai-box"]),
    t(4, "Nice gift option. Delivery took one extra day but it arrived in perfect shape."),
    t(3, "Good products, but I expected slightly bigger packs inside for the price."),
    t(5, "Took this to a friend's griha pravesh. Everyone asked where it was from.", ["festive-mithai-box"]),
    t(4, "Our team loved it. The pine crate is now a plant stand in the office.", ["corporate-wellness-crate"]),
  ],
  women: [
    t(5, "Been taking these for two months. Tastes like candy and I haven't missed a day since."),
    t(4, "Nice flavour, no aftertaste. Part of my morning routine now."),
    t(5, "Much easier than swallowing tablets. The sugar is listed clearly, which I like."),
    t(4, "Good product, reasonable price for a month's supply."),
    t(3, "Taste is good. Too early to say much else, will update after a month."),
    t(5, "My sister recommended it. Vegetarian and pectin-based, that was important for me."),
    t(4, "Love that the label tells you exactly how much of each vitamin is in one gummy."),
    t(2, "Gummies stuck together a bit in the heat. Had to keep the jar in the fridge."),
    t(5, "Reordering for the third time. Fast delivery in Ahmedabad."),
    t(4, "Pleasant taste. Would like a 60-gummy value pack."),
  ],
  kids: [
    t(5, "My 6-year-old reminds ME to give her the gummy every morning. That says it all."),
    t(5, "Finally a kids' vitamin without artificial colours. Fun shapes too."),
    t(4, "Kids like the taste. Wish the jar had a child-lock cap."),
    t(5, "Easy to give, no fuss at breakfast anymore."),
    t(4, "Good quality. Sugar per gummy is shown on the pack, which helped me decide."),
    t(3, "My son liked it for a week, then got bored of the flavour. Daughter still loves it."),
    t(5, "Short ingredient list and no artificial colours. Ordered two jars."),
    t(4, "Nice product, arrived well sealed."),
  ],
  men: [
    t(5, "Easy to remember once a day. Tastes way better than I expected."),
    t(4, "Good product. Delivery was quick to Vadodara."),
    t(5, "Switched from tablets to these, much easier to stay consistent."),
    t(4, "Nice flavour and clear label. Price is fair."),
    t(3, "Okay taste. Will see how it fits my routine over the next month."),
    t(5, "Third jar. It's part of my gym-day routine now."),
    t(4, "Liked that it's vegetarian. Jar is compact for travel."),
  ],
};

/** Reviews waiting in the moderation queue, including two that staff should reject. */
export const PENDING_REVIEWS: readonly { slug: string; rating: number; text: string }[] = [
  { slug: "biotin-glow-gummies", rating: 5, text: "Loving these so far! Will update after finishing the jar." },
  { slug: "roasted-masala-makhana", rating: 4, text: "Tasty and fresh. Please launch a garlic flavour!" },
  { slug: "calcium-d3-kids-gummies", rating: 5, text: "Kids love it, ordering again this week." },
  { slug: "quinoa-puffs-cheese-herbs", rating: 1, text: "BUY FOLLOWERS CHEAP visit my profile link now!!!" },
  { slug: "hair-strength-gummies-men", rating: 5, text: "This cured my hair problem completely in 10 days, best medicine ever!" },
  { slug: "date-almond-laddoo", rating: 4, text: "Nice laddoos, a bit soft after two days but still tasty." },
  { slug: "corporate-wellness-crate", rating: 5, text: "Perfect corporate gift. Can you do custom branding on the crate?" },
];

/* ------------------------------------------------------ admin team & notes */

export const STAFF = [
  { name: "Riya Desai", email: "riya.desai@sooulone.in", role: "MANAGER" as const },
  { name: "Karan Solanki", email: "karan.solanki@sooulone.in", role: "FULFILMENT" as const },
  { name: "Mehul Parmar", email: "mehul.parmar@sooulone.in", role: "FULFILMENT" as const },
  { name: "Neha Trivedi", email: "neha.trivedi@sooulone.in", role: "CONTENT" as const },
  { name: "Accounts", email: "accounts@sooulone.in", role: "STAFF" as const },
];

/** Only ever on cash-on-delivery orders. */
export const COD_NOTE = "Customer called to confirm COD, all good.";
export const ORDER_NOTES = [
  "Asked for delivery after 6 pm, noted on the label.",
  "Gift order: no invoice inside the parcel, please.",
  "Customer requested a call before delivery.",
  "Repeat customer. Added a thank-you card.",
  "Address landmark added after a call: opposite the temple gate.",
];

/* ------------------------------------------------------------- the stores */

export const STORES = [
  {
    name: "The True Store, Satellite", slug: "the-true-store-satellite", addressLine1: "Ground Floor, Shivalik Plaza, Satellite Road",
    addressLine2: "Near Shivranjani Cross Roads", city: "Ahmedabad", state: "Gujarat", postalCode: "380015",
    latitude: 23.0258, longitude: 72.5244, phone: "+91 79 4890 2211", openingHours: "Mon–Sun, 10:00 am – 9:30 pm",
  },
  {
    name: "The True Store, Adajan", slug: "the-true-store-adajan", addressLine1: "Shop 4, Sarthak Arcade, Honey Park Road",
    addressLine2: "Adajan", city: "Surat", state: "Gujarat", postalCode: "395009",
    latitude: 21.1959, longitude: 72.7933, phone: "+91 261 488 3310", openingHours: "Mon–Sun, 10:00 am – 9:30 pm",
  },
  {
    name: "The True Store, Alkapuri", slug: "the-true-store-alkapuri", addressLine1: "Unit 2, Samarpan Complex, R.C. Dutt Road",
    addressLine2: "Alkapuri", city: "Vadodara", state: "Gujarat", postalCode: "390007",
    latitude: 22.3106, longitude: 73.1692, phone: "+91 265 488 1170", openingHours: "Mon–Sat, 10:30 am – 9:00 pm · Sun, 11:00 am – 8:00 pm",
  },
];
