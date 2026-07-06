package pl.filmowo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import pl.filmowo.location.DeviceRegion

/**
 * The region precedence that fixes "in Poland, country resolved to Canada":
 * GPS → network → SIM → device locale, with the physical-network country winning
 * over a Canadian device locale.
 */
class DeviceRegionTest {
    @Test fun `a GPS fix wins over every other signal`() {
        assertEquals("GB", DeviceRegion.pickCountry("gb", "pl", "us", "ca"))
    }

    @Test fun `the network country beats the SIM and the device locale`() {
        // The bug: phone on a Polish network, but a Canadian device locale.
        assertEquals("PL", DeviceRegion.pickCountry(null, "pl", "ca", "ca"))
    }

    @Test fun `falls through blanks to the SIM, then the locale`() {
        assertEquals("US", DeviceRegion.pickCountry(null, "", "us", "ca"))
        assertEquals("CA", DeviceRegion.pickCountry(null, "", "", "ca"))
    }

    @Test fun `normalises case and whitespace, and rejects non-2-letter values`() {
        assertEquals("PL", DeviceRegion.pickCountry(" pl "))
        assertNull(DeviceRegion.pickCountry(null, "", "   ", ""))
        assertNull(DeviceRegion.pickCountry("USA", "1", "x"))
    }
}
