# @wsrt/persistence

> This package is part of WSRT, which is under active early development.

Runtime-neutral persistence contracts, versioned records, migrations, and isolated plugin storage.

This package owns the persistence provider interface and persisted record formats. It
does not choose a storage location or import a concrete provider. Most applications
receive it through `wsrt`; provider authors can depend on it directly.

Concrete providers must preserve workspace isolation, record versions, and plugin
namespaces. The initial formats are alpha and may change before WSRT 1.0.
