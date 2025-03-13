
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
// Disable prefetch as it is not supported for "Transaction" pool mode used by supabase
const client = postgres(process.env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, {
    schema
});


const [firstGuide] = await db.insert(schema.guides).values({
    title: "Your New Life",
}).returning();

await db.insert(schema.tasks).values({
    guideId: firstGuide.id,
    order: 0,
    instructions: {
        type: "count",
        version: 1,
        required: 150,
        action: "edge",
        displayText: [
            { showFrom: 1, text: "Good start" },
            { showFrom: 2, text: "Keep going" },
            { showFrom: 5, text: "Keep denying yourself" },
            { showFrom: 10, text: "Prove you're worth being my fucktoy" },
            { showFrom: 20, text: `Not many people are born with such highly intelligent polylingual brain such as yours. You could do amazing things in whatever field you decide to focus on if you tried. But that's not what you're going to do. You're going to throw that away without thinking twice and dedicate your life to serving and pleasuring me in every way possible. You're going to do that knowing just how horribly I will absolutely  treat you. In every way this is an objectively bad decision for you but you're going to do it anyway because you know there isn't really any "you".` },
            { showFrom: 30, text: `You know however hard you try the world will see you for what you really are, as a just an animate piece of meat. You're worthless. Except, that is, for when your makeup smeared face is pressed up against my crotch and your brain is slowly being starved of oxygen from the my cock wedged in your throat.` },
            { showFrom: 40, text: `You're going to deliberately and irrevocably brain rot yourself to better serve me. From the moment you wake up to the moment you fall asleep you're going to make sure you’re never sober. When I'm not using you you’re going keep edging yourself though out the day, every day. Both so you're always in the best state to be my fuck doll but also so that your brain begins to slowly ferment in the cocktail of sex related hormones. Rewiring itself to think only the most base gooner thoughts. Since you'll only be needing a limited vocabulary you'll have no need to speak anything other than bimbo english. Over time the non-master serving parts of your brain will atrophy away and you'll forget how to do everything else.` },
            { showFrom: 50, text: `Repeatedly being knocked about, out and up will take its toll. Each brain injury making in-depth thinking a little bit harder. But as your IQ drops any other pesky non-serving related thoughts will drop away too and you'll find yourself being happier. You're find yourself begging your doctor to keep upping your mind numbing psychotics until you've effectively chemically lobotomised yourself. ` },
            { showFrom: 60, text: `You'll not be taking birth control and I'm certainly not going to regularly bother with condoms so you'll just have to live in a semi-permanent state of early pregnancy. Impregnated by what could have been any number the many loads of cum you've taken recently, feeling your body slowly change, all until the point where my regular and brutal abuse of your body brings things to an end, ready to have it happen all over again. Of cause it would be easy to stop but why would I want that? I'm quite happy for my seed to make your tits swell up. I enjoy feeling your struggles grow more feeble as I firmly push you around. The nausea to make triggering your gag reflex easier is a bonus too. You’ll find headaches will make even your hormone drenched brain occasionally crave a break but any hesitancy to my advances will only result in making me harder and you to be thrown against the nearest bit of furniture and raped back into submission. Putting you back into your place as your headache is obscured by the pleasant mind numbing brain fog until once again all you can think about is how grateful you to be useful to me.` },
            { showFrom: 70, text: `You'll stop thinking of your body as your own and start only thinking about what you can do with to heighten my pleasure. Every time you're lucky enough for me to write degrading text on you, you'll go to a tattooer to have it permanently etched into your skin. My handwriting reminding you of exactly what you are in indelible ink. "Whore", "Bitch", "Dumb fuck", "Piss bottle", "Breedable", "Rapeable". “No means yes”` },
            { showFrom: 80, text: `If I call you into the room and you see a red hot branding iron in my hand with a property claim on the stamp you'll turn around and gladly bend over. And being brain broken slut you are as blistering white hot pain quickly annihilates every other sense and reflexive tears rolling down your cheeks you'll still manage to say "Thank you Sir" and mean it. Later you’ll think back proudly to the moment knowing even if I treat you like less than an animal I still care enough about you to claim you as mine.` },
            { showFrom: 90, text: `Get use to not putting yourself to bed. When I'm done with you for the night, when my cock gives it's final twitch buried deep in your stretched and aching asshole, I’ll pull out leaving cum, blood and any other bodily fluids to lazily leak out of you. Then you will gently lick my cock clean, kiss my feet and thank you me for using you. Once you're cleaned yourself up you'll lube up your asshole to make it easier for me to slip in on the off chance I wake up in the middle of the night and feel like a quick wank. Then you'll crawl into the dog bed at the foot of the bed and fall asleep thinking how lucky you are.` },
            { showFrom: 100, text: `Whenever I'm home you'll spend most of your time living at my feet, always within hair pulling distance. Mouth automatically opening in a pavlovian response to the sound of my fly unzipping. Tongue out, saliva flowing, ready to take my cock. Unsure precisely how you'll serve me but happy for the opportunity. Maybe you’ll receive a busied oesophagus from a rough thought fucking. Or maybe I need to empty my bladder and you're about to be my personal chamber pot. You’ll know straight away if that’s the case because generally I’ll not even bother to stick my cock in and instead just roughly aim a heavy stream of piss at your mouth, letting some of it splatter on your face and making sure you get a good taste of it on the way down. However I end up using you you’ll be sure to show your gratitude.` },
            { showFrom: 110, text: `Sometimes when bored I'll just bend down and whisper in your ear "piss yourself" and whatever you're doing, whatever you're wearing you're going to keep your head down and watch the wet patch on your crotch spread as you feel hot sticky pee running down your legs and when you're done you're going to lap up any spillage on the floor and go redo your whole slut dress prep routine.` },
            { showFrom: 120, text: `Always hoping to impress me you'll keep looking for new ways to degrade yourself in front of me. Licking the soles of my feet and sucking my toes because you know you find the idea a little repulsive. If you’re lucky throw up and be able to further impress me by eagerly lapping up your own sick. But I get bored easily over time you’ll need to keep outdoing yourself. Each time pushing the boundaries of your own disgust a little further. Eventually you'll find yourself doing unspeakably awful things to yourself that you would have never even dreamed you’d be capable of before we met.` },
            { showFrom: 130, text: `By giving yourself over to me you accept that as an anal only whore you’re never gonna be allowed to touch your cunt of your own volition ever again. Your asshole will always be your main fuckhole. If I tell you to bend over and spread yourself for me you will default to spreading your boypussy. I might choose to use to use your cunt sometimes and if you’re really lucky I might even give you permission to touch it yourself sometimes as a reword. But gone are the days where you can just freely jack off that cunt whenever you feel like it.` },
            { showFrom: 140, text: `From now on your cunt will be mostly there as a nice bit of decoration for me. And I’m honing to make sure you well and truely understand that. If I strap you down to a chair, legs spread apart, cunt exposed and loosely shove a rag in your mouth keep in mind that rag is generously provided mostly for your sake. It’s its to stop you biting off your own tongue when I take an ordinary hole punch and stamp out a neat row of holes running down each pussy lip. I’ll be cauterising each wound with a boiling hot eyelet, eventually allowing you to lace up your cunt like a common shoe. You’re going to take great care matching up your cuntlace to each day’s outfit, tying an elegant bow on top and sometimes further accessorising it with jewellery hanging of it. The bow will likely rub slightly uncomfortably against your clit all day, keeping you aroused while denying you any real pleasure. If I ever think you are enjoying yourself a little too much I’ll be swapping out the laces for a lockable cage that protects your clit from any risk of being accidentally stimulated.` },
            { showFrom: 144, text: `3` },
            { showFrom: 145, text: `2` },
            { showFrom: 146, text: `1` },
            { showFrom: 147, text: `.` },
            { showFrom: 148, text: `..` },
            { showFrom: 149, text: `...` },
            { showFrom: 150, text: `CUM NOW` },
        ],
    }
});

await client.end();