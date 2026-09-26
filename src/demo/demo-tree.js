// The demo's tree (SPEC §5.5), built by scripts/build-demo.mjs through the extension's own
// prompt, transport and checks, from the paragraphs of demo.html: a selected run, the first with
// every node on the page and no flags (the script's header says which run this is). It is an
// adaptation of the Wikipedia text in demo.html and shares its licence, CC BY-SA 4.0 (see
// demo.html). Generated file: rebuild it with the script rather than editing it.

export const DEMO_META = {
  "title": "Mary Mallon",
  "revision": 1376401637,
  "url": "https://en.wikipedia.org/w/index.php?title=Mary_Mallon&oldid=1376401637",
  "license": "CC BY-SA 4.0",
  "provider": "OpenAI",
  "model": "gpt-5.5",
  "built": "2026-09-24",
  "paragraphs": 35,
  "textSha256": "6a45e5ffa7f77da06019939c67b743b42a5dd117c2003e7ff6a27e6f652cb6cc"
};

export const DEMO_TREE = {
  "kind": "narrative",
  "verdict": "Mary Mallon was the first asymptomatic typhoid carrier identified in the U.S.; her suspected role in outbreaks led to long confinement and later ethical reexamination of the balance between individual liberty and public health.",
  "verdict_src": [
    1,
    4
  ],
  "verdict_basis": "She was the first person in the U.S. to be identified as an asymptomatic carrier of Salmonella typhi bacteria.",
  "zh": "玛丽·马龙是美国首位被确认的无症状伤寒携带者；她在疫情中的疑似作用导致长期隔离，并使其个案后来被重新审视为个人自由与公共卫生之间的伦理问题。",
  "branches": [
    {
      "title": "Mallon was linked to multiple typhoid outbreaks and up to fifty-seven infections, though early investigations did not always identify her as the source.",
      "src": [
        1,
        6,
        7,
        8,
        9,
        11,
        12,
        21
      ],
      "basis": "Mary Mallon (September 23, 1869 – November 11, 1938), commonly known as Typhoid Mary, was an Irish-born cook who lived in the United States from a young age and is believed to have infected up to fifty-seven people with the bacteria that cause typhoid fever.",
      "zh": "马龙被关联到多起伤寒暴发和多达五十七例感染，尽管早期调查并不总是认定她为源头。",
      "body": "The article traces typhoid cases across households where Mallon worked as a cook, while noting that some investigators initially blamed other servants. Soper later mapped her employment history to known typhoid cases and identified twenty-six cases connected to her before later outbreaks added to the record.",
      "children": [
        {
          "quote": "He saw she had worked for eight families, seven of whom had suffered typhoid outbreaks.",
          "src": [
            11
          ],
          "derived": false
        },
        {
          "quote": "In January and February 1915, the hospital was the center of a typhoid outbreak with twenty-five cases; two people died.",
          "src": [
            21
          ],
          "derived": false
        }
      ]
    },
    {
      "title": "Soper’s investigation treated Mallon as a potential healthy carrier, and health officials forcibly isolated her after she refused testing.",
      "src": [
        10,
        11,
        13,
        15,
        16,
        17
      ],
      "basis": "He developed the hypothesis that Mallon was a healthy carrier of typhoid and wished to gain samples from her to test his idea.",
      "zh": "索珀的调查将马龙视为可能的健康携带者，而她拒绝检测后卫生官员强制将其隔离。",
      "body": "Soper eliminated standard typhoid sources in the Warren outbreak and became more convinced Mallon could be the disease vector. When attempts to obtain samples failed, health officials and police apprehended her, and repeated stool tests found typhoid bacilli before she was transferred to Riverside Hospital.",
      "children": [
        {
          "quote": "In the first phase of his investigation, Soper eliminated the standard causes of typhoid: contact with infected people and contamination of the food, water, and milk supplies.",
          "src": [
            10
          ],
          "derived": false
        },
        {
          "quote": "Her stools were tested three times a week and showed the presence of Bacillus typhosus.",
          "src": [
            17
          ],
          "derived": false
        }
      ]
    },
    {
      "title": "Her release depended on avoiding cooking and reporting to officials, but a later hospital outbreak led to her return to North Brother Island until death.",
      "src": [
        19,
        20,
        21,
        22,
        23,
        24
      ],
      "basis": "She signed an agreement to report to the health department every quarter and that she would not return to cooking as a career, which the department felt was sufficient to ensure she would not spread typhoid to others.",
      "zh": "她获释的条件是避免从事烹饪并向官方报到，但后来的医院疫情使她被送回北兄弟岛直至去世。",
      "body": "In 1910, the new health commissioner released Mallon after she promised to avoid preparing food for others. After Sloane Maternity Hospital’s 1915 outbreak, Soper identified “Mary Brown” as Mallon, and she was returned to North Brother Island, where she remained through later work, illness, and death.",
      "children": [
        {
          "quote": "She has promised to report to me regularly and not to take another position as a cook.",
          "src": [
            20
          ],
          "derived": false
        },
        {
          "quote": "She had left the hospital's employment by that time and it was not until March 1915 that she was apprehended and returned to North Brother Island.",
          "src": [
            22
          ],
          "derived": false
        }
      ]
    },
    {
      "title": "The article presents Mallon’s treatment as exceptional compared with other asymptomatic carriers and shaped by social perceptions.",
      "src": [
        4,
        26,
        28,
        29,
        30
      ],
      "basis": "She was treated differently from the four hundred other asymptomatic typhoid carriers identified during her confinement.",
      "zh": "文章把马龙所受待遇呈现为相较其他无症状携带者的例外，并受到社会观感影响。",
      "body": "Other asymptomatic carriers were not quarantined as long as Mallon, and some were helped into non-food work. The article also records historians’ and scholars’ arguments that class, immigrant status, gender, press treatment, and public-health law shaped how she was perceived and confined.",
      "children": [
        {
          "quote": "By the time of Mallon's death, there were over four hundred recorded cases of asymptomatic typhoid carriers; none of them were detained or quarantined for as long as she was.",
          "src": [
            28
          ],
          "derived": false
        },
        {
          "quote": "According to Leavitt, Mallon's status as a working-class immigrant appears to have shaped both public and scientific perceptions of her.",
          "src": [
            29
          ],
          "derived": false
        }
      ]
    },
    {
      "title": "Mallon’s nickname and case became enduring shorthand for disease spreading and a recurring lens for debates during later epidemics.",
      "src": [
        3,
        31,
        32,
        33,
        34,
        35
      ],
      "basis": "The phrase Typhoid Mary is now a colloquial term for anyone who spreads disease.",
      "zh": "马龙的绰号和个案成为疾病传播者的持久代称，并在后来的疫情辩论中反复被引用。",
      "body": "The article shows how “Typhoid Mary” shifted from a health-department nickname into a dehumanizing public label and then a broader colloquial expression. Later writers and academics revisited Mallon during HIV/AIDS, tuberculosis, and COVID-19, while popular culture used the name in plays, comics, films, and television.",
      "children": [
        {
          "quote": "Wald describes the name \"Typhoid Mary\" as a \"dehumanizing epithet\".",
          "src": [
            31
          ],
          "derived": false
        },
        {
          "quote": "When COVID-19 began spreading in 2019, several academics looked at Mallon's case in light of social-distancing measures.",
          "src": [
            32
          ],
          "derived": false
        }
      ]
    }
  ]
};
