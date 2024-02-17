export async function loadCycles() {
    try {
        const response = await fetch(`./cycles/cycle_defs.json`);
        if (!response.ok) {
            throw new Error(`HTTP error when fetching wave cycles: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error("Unable to fetch wave cycles:", error);
    }
}
