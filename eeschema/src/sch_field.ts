/**
 * Field helpers. Counterpart: `eeschema/sch_field.cpp`.
 *
 * A netclass directive label stores the netclass it applies in a field whose
 * name is "Netclass" — but files written by a translated build (or shared
 * across languages via git) carry the translated name instead, so
 * `SCH_FIELD::GetCanonicalName` maps any of them back. The table below is
 * `GetKnownNetclassFieldTranslations()`, verbatim.
 */

/** GetKnownNetclassFieldTranslations() — "Netclass" in every shipped locale. */
export const NETCLASS_FIELD_TRANSLATIONS: readonly string[] = [
  'صنف الشبكة', // ar
  'Верига Клас', // bg
  'Classe de xarxa', // ca
  'Třídy spojů', // cs
  'Netklasse', // da, nl
  'Netzklasse', // de
  'Κλάση Δικτύου', // el
  'Clase de red', // es, es_MX
  'Ühendusniidiklass', // et
  'Verkkoluokka', // fi
  "Classe d'Equipot", // fr
  'מחלקת רשת', // he
  'नेट क्लास', // hi
  'Hálózatosztály', // hu
  'Kelas Net', // id
  'Netclass', // it, ro (same as canonical)
  'ネットクラス', // ja
  'ქსელის კლასი', // ka
  '네트 클래스', // ko
  'Grandinių klasė', // lt
  'Tīklu klase', // lv
  'Nettklasse', // no
  'Klasy sieci', // pl
  'Classes da rede', // pt_BR
  'Classe de Rede', // pt
  'Класс цепей', // ru
  'Triedy spojov', // sk
  'Razred vozlišča', // sl
  'Класа везе', // sr
  'Nätklass', // sv
  'நிகர வகுப்பு', // ta
  'నెట్ క్లాస్', // te
  'เน็ตคลาส', // th
  'Ağ Sınıfı', // tr
  "Клас зв'язків", // uk
  'Lớp mạng', // vi
  '网络类', // zh_CN
  '網路類', // zh_TW
];

/** SCH_FIELD::IsNetclassLabelFieldName. */
export function isNetclassFieldName(name: string): boolean {
  return name === 'Netclass' || NETCLASS_FIELD_TRANSLATIONS.includes(name);
}
