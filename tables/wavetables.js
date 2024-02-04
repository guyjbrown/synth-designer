const TABLE_NAMES = [
    "bleep_combsaw",
    "bleep_guttural",
    "bleep_karplus",
    "bleep_ringhold",
    "braids_bell",
    "braids_bowed",
    "braids_drone_01",
    "braids_drone_02",
    "braids_fantasy",
    "braids_female",
    "braids_male",
    "braids_metal",
    "braids_shamus",
    "braids_slap",
    "braids_string",
    "braids_tanpura",
    "braids_vibes"
];

export async function loadWaveTables() {
    try {
        // wait for all promises
        let promises = TABLE_NAMES.map(async (name) => {
            let json = await fetchJSONData(name);
            return json;
        });
        let tables = await Promise.all(promises);
        // combine all wave tables into single map
        let combinedTable = tables.reduce((acc, table) => ({ ...acc, ...table }), {});
        return combinedTable;
    } catch (error) {
        console.error("Error loading wave table: ", error);
    }
}

async function fetchJSONData(name) {
    try {
        const response = await fetch(`./tables/${name}.json`);
        if (!response.ok) {
            throw new Error(`HTTP error when fetching wave table: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error("Unable to fetch wave table:", error);
    }
}
