<!--
author:   Your Name
language: en
version:  0.1.0

script:   lia-reader.js

edit:

narrator: UK English Female
language: en

@onload
LiaReader.config.lang = "en";
LiaReader.config.engine = "responsivevoice";  // or "native"
LiaReader.config.rvVoice = "UK English Female";
@end
-->

# Reader demo

Look for the blue **Reader** button at the bottom right of the page.
Press it to open a distraction-free view of the current slide.

If you select some text first, only that selection is read.

In the reader, **click any word to hear it alone** (tick *Slow words* for pronunciation practice). **Shift+click** a word, or untick *Click word*, to read on from that sentence.

## Setup

1. Put `lia-reader.js` next to this file in a GitHub repository.
2. Replace the `script:` line in the header with the raw file URL, for example:

   `script: https://cdn.jsdelivr.net/gh/YOUR-USER/YOUR-REPO@main/lia-reader.js`

3. Open the course with
   `https://liascript.github.io/course/?https://raw.githubusercontent.com/bf-mya/lia-im/refs/heads/main/readme.md`

## Sample text for a job-seeker lesson

Dear Hiring Manager, I am writing to apply for the warehouse supervisor position advertised on your website.
I have five years of experience in logistics. I am confident that my skills match your requirements.

---

- Mr Peters has managed a team of twelve people.
- He is fluent in Dutch, French and English.

## Calling it from a script

Use this when you want a button or a text of your own:

```js
LiaReader.read("Good morning. Tell me about yourself.");
```

Other calls: `LiaReader.open()`, `LiaReader.close()`.

The reader uses ResponsiveVoice by default (LiaScript loads it for you) and falls back to the browser's own voices if it is missing. Set `LiaReader.config.engine = "native"` to force the browser voices, which also gives word-by-word highlighting.

To exclude something from the reader, wrap it in an element with `data-lia-reader-ignore`.
