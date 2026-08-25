import type { DeepPartial } from "../types";
import type { Dictionary } from "./en";

/**
 * French dictionary — deliberately partial.
 *
 * It demonstrates the mechanism rather than shipping a finished translation: keys
 * present here are used, keys absent fall back to English, and TypeScript rejects a
 * key that does not exist in the reference dictionary. Completing the French build
 * is a matter of filling in the gaps in this one file.
 */
export const fr: DeepPartial<Dictionary> = {
  brand: {
    tagline: "L'immobilier montréalais, décodé.",
    description:
      "Explorez les prix résidentiels, les loyers, l'inventaire et les tendances par quartier à Montréal.",
  },

  nav: {
    overview: "Aperçu",
    rent: "Louer",
    buy: "Acheter",
    sell: "Vendre",
    invest: "Investir",
    neighbourhoods: "Quartiers",
    compare: "Comparer",
    menu: "Menu",
    closeMenu: "Fermer le menu",
  },

  actions: {
    exploreMarket: "Explorer le marché",
    compareNeighbourhoods: "Comparer les quartiers",
    viewDashboard: "Voir le tableau de bord",
    retry: "Réessayer",
    reset: "Réinitialiser",
    showTable: "Tableau",
    showChart: "Graphique",
    viewAll: "Voir tous les quartiers",
    calculate: "Calculer",
  },

  selector: {
    label: "Explorer",
    placeholder: "Choisir un quartier",
    ariaLabel: "Choisir un quartier",
    allNeighbourhoods: "Tous les quartiers",
  },

  propertyTypes: {
    condo: "Condo",
    house: "Maison",
    plex: "Plex",
  },

  bedroomTypes: {
    studio: "Studio",
    oneBedroom: "1 chambre",
    twoBedroom: "2 chambres",
    threeBedroom: "3 chambres et plus",
  },

  ranges: {
    "1y": "1 an",
    "3y": "3 ans",
    "5y": "5 ans",
  },

  conditions: {
    buyers: "Marché d'acheteurs",
    balanced: "Marché équilibré",
    sellers: "Marché de vendeurs",
  },

  provenance: {
    demoLabel: "Données de démonstration",
    demoQualifier: "Ne reflète pas le marché réel",
    sourcePrefix: "Source",
    updatedPrefix: "Mis à jour",
  },
};
