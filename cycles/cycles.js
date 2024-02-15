const CYCLE_NAMES = [
    "bansuri",
    "fairvoice",
    "moogsaw",
    "nylon",
    "random",
];

export async function loadCycles() {
    try {
        // wait for all promises
        let promises = CYCLE_NAMES.map(async (name) => {
            let json = await fetchJSONCycle(name);
            return json;
        });
        let cycles = await Promise.all(promises);
        // combine all wave tables into single map
        let combinedCycles = cycles.reduce((acc, cycle) => ({ ...acc, ...cycle }), {});
        return combinedCycles;
    } catch (error) {
        console.error("Error loading cycle: ", error);
    }
}

async function fetchJSONCycle(name) {
    try {
        const response = await fetch(`./cycles/${name}.json`);
        if (!response.ok) {
            throw new Error(`HTTP error when fetching cycle: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error("Unable to fetch cycle:", error);
    }
}
