# kotlinx.serialization keeps generated serializers referenced only by reflection.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class pl.filmowo.** {
    kotlinx.serialization.KSerializer serializer(...);
}
