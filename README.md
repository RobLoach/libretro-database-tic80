# libretro-database-tic80

This repository serves three functions for integrating [libretro](https://www.libretro.com/)/RetroArch with [TIC-80](https://tic.computer/).

1. Downloads the [TIC-80 games](https://tic.computer/play?cat=0&sort=1)
2. Construct a database file for [libretro-database/TIC-80.dat](https://github.com/libretro/libretro-database/blob/master/dat/TIC-80.dat)
3. Downloads the thumbnails for [libretro-thumbnails/TIC-80](https://github.com/libretro-thumbnails/TIC-80)

## Usage

1. Install Node.js >= 10
2. Clone the repository
    ```
    git clone https://github.com/RobLoach/libretro-database-tic80.git
    cd libretro-database-tic80
    ```
3. Update the git submodules
    ```
    git submodule update --init --recursive
    ```
4. Build the files
    ```
    npm it
    ```
5. See the `carts` directory for all the games and the updated contents in thumbnails, and libretro-database.
