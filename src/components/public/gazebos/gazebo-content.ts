/**
 * Per-gazebo copy for the public catalog. Every statement is checkable:
 * layout and furniture come from the approved photographs (see gazebo-photos.ts),
 * the rental kit from the public offer (content/legal/gazebos-offer, п. 6.6 and
 * Приложение № 1, п. 2.1). Capacity, heating, prices and «интернет/ТВ» are NOT
 * repeated here — they render from live resource data.
 *
 * Rules for editing: no adjectives that cannot be seen or measured
 * («уютная», «идеальная», «незабываемый»), no promises, no counts that are not
 * in the photos or the database.
 */
export type GazeboContent = {
  number: number;
  summary: string;
  specs: readonly { label: string; value: string }[];
};

export const GAZEBO_CONTENT: readonly GazeboContent[] = [
  {
    number: 1,
    summary: "Прямоугольный домик с панорамными окнами по фасаду и боковой стене, со шторами. Вся компания сидит за одним длинным столом.",
    specs: [
      { label: "Внутри", value: "Длинный деревянный стол, плетёные кресла" },
      { label: "Мангал", value: "Рядом с беседкой, под навесом на мощёной площадке" },
    ],
  },
  {
    number: 2,
    summary: "Многогранный павильон с окнами по кругу и шторами. Большой стол стоит в центре, кресла — вокруг него.",
    specs: [
      { label: "Внутри", value: "Лакированный стол в центре, плетёные кресла" },
      { label: "Мангал", value: "Под навесом на мощёной площадке у беседки" },
    ],
  },
  {
    number: 3,
    summary: "Многогранный павильон с окнами по кругу и шторами, большой стол в центре. Рядом на лужайке — деревянная скамейка.",
    specs: [
      { label: "Внутри", value: "Лакированный стол в центре, плетёные кресла" },
      { label: "Мангал", value: "Под навесом на мощёной площадке у беседки" },
    ],
  },
  {
    number: 4,
    summary: "Многогранный павильон с окнами по кругу и шторами, большой стол в центре. К входу ведёт дорожка вдоль клумбы.",
    specs: [
      { label: "Внутри", value: "Лакированный стол в центре, плетёные кресла" },
      { label: "Мангал", value: "Под навесом на мощёной площадке у беседки" },
    ],
  },
  {
    number: 5,
    summary: "Длинный стол с лавками во всю длину беседки. У второго входа — деревянная терраса с уличной мебелью.",
    specs: [
      { label: "Внутри", value: "Длинный стол, деревянные лавки, телевизор на стене" },
      { label: "Терраса", value: "Деревянный настил, уличные кресла и столик" },
      { label: "Мангал", value: "Под кованым навесом у стены здания" },
    ],
  },
];

/** What every booking includes — offer п. 6.6. Shown once for the whole section. */
export const GAZEBO_INCLUDED: readonly string[] = [
  "Стол и посадочные места",
  "Мангал, решётка для гриля и опахало",
  "6 шампуров",
  "3 кг угля и 0,5 л розжига",
  "Туалет на территории",
  "Парковка",
];

export function getGazeboContent(number: number): GazeboContent | undefined {
  return GAZEBO_CONTENT.find((item) => item.number === number);
}
