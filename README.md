# libretro-database-tic80

This repository serves three functions for integrating [libretro](https://www.libretro.com/)/RetroArch with [TIC-80](https://tic80.com/).

1. Downloads the [TIC-80 carts](https://tic80.com/play) from the Games, Tech, Music, and Demoscene categories
2. Construct a database file for [libretro-database/TIC-80.dat](https://github.com/libretro/libretro-database/blob/master/dat/TIC-80.dat)
3. Downloads the thumbnails for [libretro-thumbnails/TIC-80](https://github.com/libretro-thumbnails/TIC-80)

## Usage

1. Install Node.js >= 22
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
    npm install
    npm start
    ```
5. See the `carts` directory for all the games and the updated contents in `thumbnails` and `libretro-database`.

Carts and thumbnails that already exist are not downloaded again. The build exits with an error if any download fails, or if a category returns no carts, which usually means the tic80.com markup has changed.

## Automation

The [Build workflow](.github/workflows/build.yml) runs monthly, and on demand, and uploads the generated `TIC-80.dat` and new thumbnails as artifacts.
