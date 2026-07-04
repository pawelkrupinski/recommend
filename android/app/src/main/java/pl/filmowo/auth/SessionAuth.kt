package pl.filmowo.auth

import android.content.Context

/**
 * The session operations the view model depends on, kept as an interface so the
 * view model depends on an abstraction rather than the Custom-Tabs/Context-bound
 * [AuthRepository] — tests swap in a boring fake through the same seam.
 */
interface SessionAuth {
    fun startWebSignIn(context: Context, provider: String)
    suspend fun exchangeCode(code: String): Boolean
    suspend fun signOut()
    suspend fun deleteAccount()
}
